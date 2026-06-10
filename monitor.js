const { ethers } = require("ethers");
const {
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  ERC20_ABI,
  BASE_TOKENS,
  ETH_TOKENS,
  V2_FACTORIES,
  V3_FACTORIES,
  ADDRESSES,
} = require("./constants");

const {
  alertNewToken,
  alertFirstBuy,
  alertLiquidityAdded,
  alertLiquidityWarning,
  alertLiquidityRemoved,
} = require("./notifier");

const { getTokenInfo } = require("./tokenInfo");
const { getEthPriceUSD, ethToUSD } = require("./price");

// Track which tokens we've already sent "first buy" for
const firstBuyDone = new Set();

// Track liquidity snapshots { pairAddress -> totalLpSupply (BigInt) }
const liquiditySnapshots = new Map();

const MIN_LIQ_USD = Number(process.env.MIN_LIQUIDITY_USD || 5000);
const MIN_BUY_USD  = Number(process.env.MIN_FIRST_BUY_USD || 10);
const WARN_THRESHOLD = Number(process.env.LIQUIDITY_REMOVAL_WARNING_THRESHOLD || 1); // any removal

// Helper: is this token the ETH/WETH side? (used for USD value calc)
function isEthToken(address) {
  return ETH_TOKENS.has(address.toLowerCase());
}

// ─────────────────────────────────────────────
// Identify which token in a pair is the "new" one
// ─────────────────────────────────────────────
function getNewToken(token0, token1) {
  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  if (BASE_TOKENS.has(t0)) return { newToken: token1, baseToken: token0 };
  if (BASE_TOKENS.has(t1)) return { newToken: token0, baseToken: token1 };
  return { newToken: token0, baseToken: token1 }; // both unknown — treat token0 as new
}

// ─────────────────────────────────────────────
// Format ETH amount from raw BigInt
// ─────────────────────────────────────────────
function fmtEth(raw, decimals = 18) {
  return parseFloat(ethers.formatUnits(raw, decimals)).toFixed(6);
}

// ─────────────────────────────────────────────
// Watch a V2-style pair for Swap, Mint, Burn
// ─────────────────────────────────────────────
async function watchV2Pair(provider, pairAddress, token0, token1, dexName) {
  const { newToken, baseToken } = getNewToken(token0, token1);
  const isToken0New = newToken.toLowerCase() === token0.toLowerCase();

  const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, provider);
  const tokenInfo = await getTokenInfo(provider, newToken);

  // ── MINT (liquidity added) ──────────────────
  pair.on("Mint", async (sender, amount0, amount1, event) => {
    try {
      const ethPrice = await getEthPriceUSD();
      const ethRaw   = isToken0New ? amount1 : amount0;
      const tokRaw   = isToken0New ? amount0 : amount1;
      const ethAmt   = fmtEth(ethRaw);
      const tokAmt   = fmtEth(tokRaw, tokenInfo.decimals);
      const valueUSD = ethToUSD(ethAmt, ethPrice);

      if (parseFloat(valueUSD) < MIN_LIQ_USD) return;

      // Save snapshot for burn comparison
      try {
        const supply = await pair.totalSupply();
        liquiditySnapshots.set(pairAddress.toLowerCase(), supply);
      } catch {}

      const txHash = event.log?.transactionHash || "unknown";
      await alertLiquidityAdded({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress,
        provider: sender,
        ethAmount: ethAmt,
        tokenAmount: tokAmt,
        totalLiqUSD: valueUSD,
        txHash,
        dex: dexName,
      });
    } catch (err) {
      console.error("Mint handler error:", err.message);
    }
  });

  // ── BURN (liquidity removed) ────────────────
  pair.on("Burn", async (sender, amount0, amount1, to, event) => {
    try {
      const ethPrice = await getEthPriceUSD();
      const ethRaw   = isToken0New ? amount1 : amount0;
      const tokRaw   = isToken0New ? amount0 : amount1;
      const ethAmt   = fmtEth(ethRaw);
      const tokAmt   = fmtEth(tokRaw, tokenInfo.decimals);

      // Calculate removal percentage from saved snapshot
      let removedPct = "?";
      try {
        const currentSupply = await pair.totalSupply();
        const prevSupply    = liquiditySnapshots.get(pairAddress.toLowerCase()) || currentSupply;
        const burned        = prevSupply - currentSupply;
        if (prevSupply > 0n) {
          removedPct = ((Number(burned) / Number(prevSupply)) * 100).toFixed(1);
        }
        liquiditySnapshots.set(pairAddress.toLowerCase(), currentSupply);

        // Send warning if ANY removal detected (threshold = 1%)
        if (parseFloat(removedPct) >= WARN_THRESHOLD) {
          const txHash = event.log?.transactionHash || "unknown";
          await alertLiquidityWarning({
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            tokenAddress: newToken,
            pairAddress,
            removalPct: removedPct,
            provider: sender,
            txHash,
          });
        }
      } catch {}

      const txHash = event.log?.transactionHash || "unknown";
      await alertLiquidityRemoved({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress,
        provider: sender,
        ethAmount: ethAmt,
        tokenAmount: tokAmt,
        removedPct,
        txHash,
      });
    } catch (err) {
      console.error("Burn handler error:", err.message);
    }
  });

  // ── SWAP (first buy detection) ──────────────
  pair.on("Swap", async (sender, amount0In, amount0Out, amount1In, amount1Out, to, event) => {
    try {
      const tokenKey = newToken.toLowerCase();
      if (firstBuyDone.has(tokenKey)) return; // already notified

      // Determine direction: is someone buying the new token?
      // A buy means: ETH/base token goes IN, new token comes OUT
      let ethIn, tokOut;
      if (isToken0New) {
        // token0 = new, token1 = base
        ethIn  = amount1In;  // base (ETH) going in
        tokOut = amount0Out; // new token coming out
      } else {
        // token0 = base, token1 = new
        ethIn  = amount0In;
        tokOut = amount1Out;
      }

      if (ethIn === 0n || tokOut === 0n) return; // not a buy

      const ethPrice = await getEthPriceUSD();
      const ethAmt   = fmtEth(ethIn);
      const tokAmt   = fmtEth(tokOut, tokenInfo.decimals);
      const valueUSD = ethToUSD(ethAmt, ethPrice);

      if (parseFloat(valueUSD) < MIN_BUY_USD) return;

      firstBuyDone.add(tokenKey);
      const txHash = event.log?.transactionHash || "unknown";

      await alertFirstBuy({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress,
        buyer: to,
        amountIn: ethAmt,
        amountOut: tokAmt,
        valueUSD,
        txHash,
      });
    } catch (err) {
      console.error("Swap handler error:", err.message);
    }
  });

  console.log(`   👀 Watching pair ${pairAddress} (${tokenInfo.symbol} / ${isToken0New ? "ETH" : "BASE"})`);
}

// ─────────────────────────────────────────────
// Watch a V2 factory for PairCreated
// ─────────────────────────────────────────────
async function watchV2Factory(provider, factoryAddress, dexName) {
  const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, provider);

  factory.on("PairCreated", async (token0, token1, pairAddress, _id, event) => {
    try {
      const { newToken } = getNewToken(token0, token1);
      const tokenInfo    = await getTokenInfo(provider, newToken);
      const txHash       = event.log?.transactionHash || "unknown";

      // Fetch deployer from tx
      let deployer = "unknown";
      try {
        const tx = await provider.getTransaction(txHash);
        deployer = tx?.from || "unknown";
      } catch {}

      await alertNewToken({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        address: newToken,
        deployer,
        txHash,
        dex: dexName,
      });

      // Start watching this new pair
      await watchV2Pair(provider, pairAddress, token0, token1, dexName);
    } catch (err) {
      console.error(`PairCreated handler error [${dexName}]:`, err.message);
    }
  });

  console.log(`✅ Watching ${dexName} factory: ${factoryAddress}`);
}

// ─────────────────────────────────────────────
// Watch a V3 factory for PoolCreated
// ─────────────────────────────────────────────
async function watchV3Factory(provider, factoryAddress, dexName) {
  const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);

  factory.on("PoolCreated", async (token0, token1, fee, tickSpacing, poolAddress, event) => {
    try {
      const { newToken } = getNewToken(token0, token1);
      const tokenInfo    = await getTokenInfo(provider, newToken);
      const txHash       = event.log?.transactionHash || "unknown";

      let deployer = "unknown";
      try {
        const tx = await provider.getTransaction(txHash);
        deployer = tx?.from || "unknown";
      } catch {}

      await alertNewToken({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        address: newToken,
        deployer,
        txHash,
        dex: `${dexName} (${fee / 10000}% fee)`,
      });

      // Watch V3 pool for Mint/Burn/Swap
      watchV3Pool(provider, poolAddress, token0, token1, dexName, tokenInfo);
    } catch (err) {
      console.error(`PoolCreated handler error [${dexName}]:`, err.message);
    }
  });

  console.log(`✅ Watching ${dexName} (V3) factory: ${factoryAddress}`);
}

// ─────────────────────────────────────────────
// Watch a V3 pool
// ─────────────────────────────────────────────
async function watchV3Pool(provider, poolAddress, token0, token1, dexName, tokenInfo) {
  const { newToken } = getNewToken(token0, token1);
  const isToken0New  = newToken.toLowerCase() === token0.toLowerCase();
  const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);

  // Mint
  pool.on("Mint", async (sender, owner, tickLower, tickUpper, amount, amount0, amount1, event) => {
    try {
      const ethPrice = await getEthPriceUSD();
      const ethRaw   = isToken0New ? amount1 : amount0;
      const tokRaw   = isToken0New ? amount0 : amount1;
      const ethAmt   = fmtEth(ethRaw);
      const tokAmt   = fmtEth(tokRaw, tokenInfo.decimals);
      const valueUSD = ethToUSD(ethAmt, ethPrice);

      if (parseFloat(valueUSD) < MIN_LIQ_USD) return;

      await alertLiquidityAdded({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress: poolAddress,
        provider: sender,
        ethAmount: ethAmt,
        tokenAmount: tokAmt,
        totalLiqUSD: valueUSD,
        txHash: event.log?.transactionHash || "unknown",
        dex: dexName,
      });
    } catch {}
  });

  // Burn
  pool.on("Burn", async (owner, tickLower, tickUpper, amount, amount0, amount1, event) => {
    try {
      const ethPrice = await getEthPriceUSD();
      const ethRaw   = isToken0New ? amount1 : amount0;
      const tokRaw   = isToken0New ? amount0 : amount1;
      const ethAmt   = fmtEth(ethRaw);
      const tokAmt   = fmtEth(tokRaw, tokenInfo.decimals);

      await alertLiquidityRemoved({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress: poolAddress,
        provider: owner,
        ethAmount: ethAmt,
        tokenAmount: tokAmt,
        removedPct: "V3",
        txHash: event.log?.transactionHash || "unknown",
      });
    } catch {}
  });

  // Swap (first buy)
  pool.on("Swap", async (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick, event) => {
    try {
      const tokenKey = newToken.toLowerCase();
      if (firstBuyDone.has(tokenKey)) return;

      // In V3: amount is signed. Positive = tokens coming into pool (user selling).
      // A BUY of newToken = newToken amount is negative (leaving pool), ETH amount is positive (entering).
      const ethBigInt  = isToken0New ? amount1 : amount0; // base token
      const tokBigInt  = isToken0New ? amount0 : amount1; // new token

      // Buy: base token positive (in), new token negative (out)
      if (ethBigInt <= 0n || tokBigInt >= 0n) return;

      const ethPrice = await getEthPriceUSD();
      const ethAmt   = fmtEth(ethBigInt > 0n ? ethBigInt : -ethBigInt);
      const tokAmt   = fmtEth(tokBigInt < 0n ? -tokBigInt : tokBigInt, tokenInfo.decimals);
      const valueUSD = ethToUSD(ethAmt, ethPrice);

      if (parseFloat(valueUSD) < MIN_BUY_USD) return;

      firstBuyDone.add(tokenKey);

      await alertFirstBuy({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        tokenAddress: newToken,
        pairAddress: poolAddress,
        buyer: recipient,
        amountIn: ethAmt,
        amountOut: tokAmt,
        valueUSD,
        txHash: event.log?.transactionHash || "unknown",
      });
    } catch {}
  });
}

// ─────────────────────────────────────────────
// Entry point — start all watchers
// ─────────────────────────────────────────────
async function startMonitor(provider) {
  console.log("\n🚀 Starting Base chain monitor...\n");

  for (const { address, name } of V2_FACTORIES) {
    await watchV2Factory(provider, address, name);
  }

  for (const { address, name } of V3_FACTORIES) {
    await watchV3Factory(provider, address, name);
  }

  const total = V2_FACTORIES.length + V3_FACTORIES.length;
  console.log(`\n✅ Monitoring ${total} DEX factories on Base mainnet\n`);
  return total;
}

module.exports = { startMonitor };
