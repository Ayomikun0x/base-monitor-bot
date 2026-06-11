const { ethers } = require("ethers");
const {
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  BASE_TOKENS,
  ETH_TOKENS,
  USDC_TOKENS,
  V2_FACTORIES,
  V3_FACTORIES,
} = require("./constants");

const {
  alertNewToken,
  alertFirstBuy,
  alertLiquidityAdded,
  alertLiquidityWarning,
  alertLiquidityRemoved,
  alertPriceMilestone,
} = require("./notifier");

const { getTokenInfo } = require("./tokenInfo");
const { getEthPriceUSD } = require("./price");

const firstBuyDone = new Set();
const liquiditySnapshots = new Map();
const priceTrackers = new Map();
const MILESTONES = [50, 100, 150, 200, 300, 500, 1000];
const WARN_THRESHOLD = 1;

function getNewToken(token0, token1) {
  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  if (BASE_TOKENS.has(t0)) return { newToken: token1, baseToken: token0 };
  if (BASE_TOKENS.has(t1)) return { newToken: token0, baseToken: token1 };
  return null;
}

function getBaseSymbol(baseToken) {
  if (ETH_TOKENS.has(baseToken.toLowerCase())) return "ETH";
  if (USDC_TOKENS.has(baseToken.toLowerCase())) return "USDC";
  return "BASE";
}

function isEthBase(baseToken) {
  return ETH_TOKENS.has(baseToken.toLowerCase());
}

function fmtUnits(raw, decimals = 18) {
  try {
    return parseFloat(ethers.formatUnits(raw, decimals));
  } catch {
    return 0;
  }
}

function calcPriceAndMcap(baseAmountFloat, baseSymbol, tokenAmountFloat, totalSupply, ethPriceUSD) {
  if (!tokenAmountFloat || tokenAmountFloat === 0) return { price: "0", mcap: "0", priceFloat: 0 };
  const baseUSD = baseSymbol === "ETH" ? baseAmountFloat * ethPriceUSD : baseAmountFloat;
  const price   = baseUSD / tokenAmountFloat;
  const mcap    = price * parseFloat(totalSupply || 0);

  let priceStr;
  if (price < 0.000001)    priceStr = price.toExponential(4);
  else if (price < 0.0001) priceStr = price.toFixed(8);
  else if (price < 0.01)   priceStr = price.toFixed(6);
  else if (price < 1)      priceStr = price.toFixed(4);
  else                     priceStr = price.toFixed(2);

  return { price: priceStr, mcap: mcap.toFixed(0), priceFloat: price };
}

function formatPrice(p) {
  if (p < 0.000001)    return p.toExponential(4);
  if (p < 0.0001)      return p.toFixed(8);
  if (p < 0.01)        return p.toFixed(6);
  if (p < 1)           return p.toFixed(4);
  return p.toFixed(2);
}

async function checkPriceMilestone(tokenAddress, name, symbol, currentPriceFloat) {
  const tracker = priceTrackers.get(tokenAddress.toLowerCase());
  if (!tracker) return;

  const gainPct = ((currentPriceFloat - tracker.firstBuyPrice) / tracker.firstBuyPrice) * 100;

  for (const milestone of MILESTONES) {
    if (gainPct >= milestone && tracker.nextMilestone <= milestone) {
      await alertPriceMilestone({
        name,
        symbol,
        tokenAddress,
        gainPct: milestone,
        currentPrice: formatPrice(currentPriceFloat),
        fromPrice: formatPrice(tracker.firstBuyPrice),
      });

      const nextIdx = MILESTONES.indexOf(milestone) + 1;
      tracker.nextMilestone = nextIdx < MILESTONES.length ? MILESTONES[nextIdx] : 999999;
      priceTrackers.set(tokenAddress.toLowerCase(), tracker);
      break;
    }
  }
}

async function watchV2Pair(provider, pairAddress, token0, token1, dexName) {
  const result = getNewToken(token0, token1);
  if (!result) return;
  const { newToken, baseToken } = result;
  const isToken0New = newToken.toLowerCase() === token0.toLowerCase();
  const baseSymbol  = getBaseSymbol(baseToken);
  const isEth       = isEthBase(baseToken);
  const pair        = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, provider);
  const tokenInfo   = await getTokenInfo(provider, newToken);

  pair.on("Mint", async (sender, amount0, amount1, event) => {
    try {
      const ethPrice  = await getEthPriceUSD();
      const baseRaw   = isToken0New ? amount1 : amount0;
      const tokRaw    = isToken0New ? amount0 : amount1;
      const baseFloat = fmtUnits(baseRaw, isEth ? 18 : 6);
      const tokFloat  = fmtUnits(tokRaw, tokenInfo.decimals);
      const valueUSD  = isEth ? baseFloat * ethPrice : baseFloat;

      try {
        const supply = await pair.totalSupply();
        liquiditySnapshots.set(pairAddress.toLowerCase(), supply);
      } catch {}

      const { price, mcap } = calcPriceAndMcap(baseFloat, baseSymbol, tokFloat, tokenInfo.totalSupply, ethPrice);

      await alertLiquidityAdded({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        tokenAddress: newToken, provider: sender,
        baseAmount: baseFloat.toFixed(4), baseSymbol,
        tokenAmount: tokFloat, totalLiqUSD: valueUSD.toFixed(2),
        txHash: event.log?.transactionHash || "unknown",
        dex: dexName, price, mcap,
      });
    } catch (err) { console.error("Mint error:", err.message); }
  });

  pair.on("Burn", async (sender, amount0, amount1, to, event) => {
    try {
      const baseRaw   = isToken0New ? amount1 : amount0;
      const tokRaw    = isToken0New ? amount0 : amount1;
      const baseFloat = fmtUnits(baseRaw, isEth ? 18 : 6);
      const tokFloat  = fmtUnits(tokRaw, tokenInfo.decimals);
      const txHash    = event.log?.transactionHash || "unknown";

      let removedPct = "?";
      try {
        const currentSupply = await pair.totalSupply();
        const prevSupply    = liquiditySnapshots.get(pairAddress.toLowerCase()) || currentSupply;
        const burned        = prevSupply - currentSupply;
        if (prevSupply > 0n) {
          removedPct = ((Number(burned) / Number(prevSupply)) * 100).toFixed(1);
        }
        liquiditySnapshots.set(pairAddress.toLowerCase(), currentSupply);
      } catch {}

      if (parseFloat(removedPct) >= WARN_THRESHOLD) {
        await alertLiquidityWarning({
          name: tokenInfo.name, symbol: tokenInfo.symbol,
          tokenAddress: newToken, removalPct: removedPct,
          provider: sender, txHash,
        });
      }

      await alertLiquidityRemoved({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        tokenAddress: newToken, provider: sender,
        baseAmount: baseFloat.toFixed(4), baseSymbol,
        tokenAmount: tokFloat, removedPct, txHash,
      });
    } catch (err) { console.error("Burn error:", err.message); }
  });

  pair.on("Swap", async (sender, amount0In, amount0Out, amount1In, amount1Out, to, event) => {
    try {
      const tokenKey  = newToken.toLowerCase();
      const ethPrice  = await getEthPriceUSD();
      const baseIn    = isToken0New ? amount1In  : amount0In;
      const tokOut    = isToken0New ? amount0Out : amount1Out;
      const baseFloat = fmtUnits(baseIn, isEth ? 18 : 6);
      const tokFloat  = fmtUnits(tokOut, tokenInfo.decimals);
      if (baseFloat === 0 || tokFloat === 0) return;

      const valueUSD = isEth ? baseFloat * ethPrice : baseFloat;
      const { priceFloat } = calcPriceAndMcap(baseFloat, baseSymbol, tokFloat, tokenInfo.totalSupply, ethPrice);

      if (!firstBuyDone.has(tokenKey)) {
        firstBuyDone.add(tokenKey);
        priceTrackers.set(tokenKey, {
          firstBuyPrice: priceFloat,
          nextMilestone: MILESTONES[0],
        });
        await alertFirstBuy({
          name: tokenInfo.name, symbol: tokenInfo.symbol,
          tokenAddress: newToken, buyer: to,
          amountIn: baseFloat.toFixed(4), baseSymbol,
          amountOut: tokFloat, valueUSD: valueUSD.toFixed(2),
          txHash: event.log?.transactionHash || "unknown",
        });
      } else {
        await checkPriceMilestone(newToken, tokenInfo.name, tokenInfo.symbol, priceFloat);
      }
    } catch (err) { console.error("Swap error:", err.message); }
  });

  console.log("Watching pair: " + pairAddress + " (" + tokenInfo.symbol + "/" + baseSymbol + ")");
}

async function watchV2Factory(provider, factoryAddress, dexName) {
  const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, provider);
  factory.on("PairCreated", async (token0, token1, pairAddress, _id, event) => {
    try {
      const result = getNewToken(token0, token1);
      if (!result) return;
      const { newToken } = result;
      const tokenInfo = await getTokenInfo(provider, newToken);
      let deployer = "unknown";
      try {
        const tx = await provider.getTransaction(event.log?.transactionHash);
        deployer = tx?.from || "unknown";
      } catch {}
      await alertNewToken({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        address: newToken, deployer,
        txHash: event.log?.transactionHash || "unknown",
        dex: dexName,
      });
      await watchV2Pair(provider, pairAddress, token0, token1, dexName);
    } catch (err) { console.error("PairCreated error [" + dexName + "]:", err.message); }
  });
  console.log("Watching " + dexName + " factory: " + factoryAddress);
}

async function watchV3Factory(provider, factoryAddress, dexName) {
  const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);
  factory.on("PoolCreated", async (token0, token1, fee, tickSpacing, poolAddress, event) => {
    try {
      const result = getNewToken(token0, token1);
      if (!result) return;
      const { newToken } = result;
      const tokenInfo = await getTokenInfo(provider, newToken);
      let deployer = "unknown";
      try {
        const tx = await provider.getTransaction(event.log?.transactionHash);
        deployer = tx?.from || "unknown";
      } catch {}
      await alertNewToken({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        address: newToken, deployer,
        txHash: event.log?.transactionHash || "unknown",
        dex: dexName + " V3 (" + (Number(fee) / 10000) + "% fee)",
      });
      watchV3Pool(provider, poolAddress, token0, token1, dexName, tokenInfo);
    } catch (err) { console.error("PoolCreated error [" + dexName + "]:", err.message); }
  });
  console.log("Watching " + dexName + " (V3) factory: " + factoryAddress);
}

async function watchV3Pool(provider, poolAddress, token0, token1, dexName, tokenInfo) {
  const result = getNewToken(token0, token1);
  if (!result) return;
  const { newToken, baseToken } = result;
  const isToken0New = newToken.toLowerCase() === token0.toLowerCase();
  const baseSymbol  = getBaseSymbol(baseToken);
  const isEth       = isEthBase(baseToken);
  const pool        = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);

  pool.on("Mint", async (sender, owner, tL, tU, amount, amount0, amount1, event) => {
    try {
      const ethPrice  = await getEthPriceUSD();
      const baseRaw   = isToken0New ? amount1 : amount0;
      const tokRaw    = isToken0New ? amount0 : amount1;
      const baseFloat = fmtUnits(baseRaw, isEth ? 18 : 6);
      const tokFloat  = fmtUnits(tokRaw, tokenInfo.decimals);
      const valueUSD  = isEth ? baseFloat * ethPrice : baseFloat;
      const { price, mcap } = calcPriceAndMcap(baseFloat, baseSymbol, tokFloat, tokenInfo.totalSupply, ethPrice);
      await alertLiquidityAdded({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        tokenAddress: newToken, provider: sender,
        baseAmount: baseFloat.toFixed(4), baseSymbol,
        tokenAmount: tokFloat, totalLiqUSD: valueUSD.toFixed(2),
        txHash: event.log?.transactionHash || "unknown",
        dex: dexName, price, mcap,
      });
    } catch (err) { console.error("V3 Mint error:", err.message); }
  });

  pool.on("Burn", async (owner, tL, tU, amount, amount0, amount1, event) => {
    try {
      const baseRaw   = isToken0New ? amount1 : amount0;
      const tokRaw    = isToken0New ? amount0 : amount1;
      const baseFloat = fmtUnits(baseRaw, isEth ? 18 : 6);
      const tokFloat  = fmtUnits(tokRaw, tokenInfo.decimals);
      const txHash    = event.log?.transactionHash || "unknown";
      await alertLiquidityWarning({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        tokenAddress: newToken, removalPct: "V3",
        provider: owner, txHash,
      });
      await alertLiquidityRemoved({
        name: tokenInfo.name, symbol: tokenInfo.symbol,
        tokenAddress: newToken, provider: owner,
        baseAmount: baseFloat.toFixed(4), baseSymbol,
        tokenAmount: tokFloat, removedPct: "V3", txHash,
      });
    } catch (err) { console.error("V3 Burn error:", err.message); }
  });

  pool.on("Swap", async (sender, recipient, amount0, amount1, sqrtP, liq, tick, event) => {
    try {
      const tokenKey   = newToken.toLowerCase();
      const ethPrice   = await getEthPriceUSD();
      const amt0       = BigInt(amount0.toString());
      const amt1       = BigInt(amount1.toString());
      const baseAmt256 = isToken0New ? amt1 : amt0;
      const tokAmt256  = isToken0New ? amt0 : amt1;
      if (baseAmt256 <= 0n || tokAmt256 >= 0n) return;
      const baseFloat  = fmtUnits(baseAmt256 < 0n ? -baseAmt256 : baseAmt256, isEth ? 18 : 6);
      const tokFloat   = fmtUnits(tokAmt256 < 0n ? -tokAmt256 : tokAmt256, tokenInfo.decimals);
      const valueUSD   = isEth ? baseFloat * ethPrice : baseFloat;
      const { priceFloat } = calcPriceAndMcap(baseFloat, baseSymbol, tokFloat, tokenInfo.totalSupply, ethPrice);

      if (!firstBuyDone.has(tokenKey)) {
        firstBuyDone.add(tokenKey);
        priceTrackers.set(tokenKey, { firstBuyPrice: priceFloat, nextMilestone: MILESTONES[0] });
        await alertFirstBuy({
          name: tokenInfo.name, symbol: tokenInfo.symbol,
          tokenAddress: newToken, buyer: recipient,
          amountIn: baseFloat.toFixed(4), baseSymbol,
          amountOut: tokFloat, valueUSD: valueUSD.toFixed(2),
          txHash: event.log?.transactionHash || "unknown",
        });
      } else {
        await checkPriceMilestone(newToken, tokenInfo.name, tokenInfo.symbol, priceFloat);
      }
    } catch (err) { console.error("V3 Swap error:", err.message); }
  });
}

async function startMonitor(provider) {
  console.log("Starting Base chain monitor...");
  for (const { address, name } of V2_FACTORIES) await watchV2Factory(provider, address, name);
  for (const { address, name } of V3_FACTORIES) await watchV3Factory(provider, address, name);
  const total = V2_FACTORIES.length + V3_FACTORIES.length;
  console.log("Monitoring " + total + " DEX factories on Base mainnet");
  return total;
}

module.exports = { startMonitor };
