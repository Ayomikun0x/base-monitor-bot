const { ethers } = require("ethers");
const axios = require("axios");

const LP_LOCKERS = {
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "Unicrypt",
  "0xdba68f07d1b7ca219f78ae8582da0548dd8f694a": "Team Finance",
  "0x71b53b55dc52a8b0a2a7f4b9c5dbda94c66a21c": "Mudra",
  "0x000000000000000000000000000000000000dead": "Burned 🔥",
  "0x0000000000000000000000000000000000000000": "Burned 🔥",
};

const TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];
// Check if the deployer sent tokens to other wallets shortly before liquidity was added
async function checkPreLiquidityTransfers(provider, tokenAddress, deployerAddress, pairCreatedBlock) {
  try {
    const LOOKBACK_BLOCKS = 300; // roughly ~10 min on Base
    const fromBlock = Math.max(0, pairCreatedBlock - LOOKBACK_BLOCKS);

    const tokenContract = new ethers.Contract(tokenAddress, TRANSFER_ABI, provider);
    const filter = tokenContract.filters.Transfer(deployerAddress, null);

    const events = await Promise.race([
      tokenContract.queryFilter(filter, fromBlock, pairCreatedBlock),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
    ]);

    if (!events || events.length === 0) {
      return { hasPreLiquidityTransfers: false, recipients: [] };
    }

    // Collect unique recipient wallets (excluding the deployer sending to themselves, if that happens)
    const recipients = new Set();
    for (const ev of events) {
      const to = ev.args?.to?.toLowerCase();
      if (to && to !== deployerAddress.toLowerCase()) {
        recipients.add(to);
      }
    }

    return {
      hasPreLiquidityTransfers: recipients.size > 0,
      recipients: Array.from(recipients),
    };
  } catch {
    // If the check fails (timeout, RPC error), don't block the alert — just report unknown
    return { hasPreLiquidityTransfers: false, recipients: [], error: true };
  }
}
// Minimum LP token amount (in raw units) to count as a "real" transfer,
// not dust from internal rounding during the mint calculation
const DUST_THRESHOLD = ethers.parseUnits("0.0001", 18);

async function checkLPLock(provider, pairAddress, txHash) {
  try {
    const receipt = await Promise.race([
      provider.getTransactionReceipt(txHash),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
    ]);
    if (!receipt) return "🔓 Unlocked ⚠️";

    const iface = new ethers.Interface(TRANSFER_ABI);
    const lpTransfers = [];

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pairAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "Transfer") {
          lpTransfers.push({
            to: parsed.args.to.toLowerCase(),
            from: parsed.args.from.toLowerCase(),
            value: parsed.args.value,
          });
        }
      } catch {}
    }

    // Ignore dust transfers (rounding artifacts from the mint math)
    const realTransfers = lpTransfers.filter(t => t.value >= DUST_THRESHOLD);
    if (realTransfers.length === 0) return "🔓 Unlocked ⚠️";

    // Only trust the LAST real transfer — that's where the LP tokens actually ended up
    const finalTransfer = realTransfers[realTransfers.length - 1];

    for (const [addr, name] of Object.entries(LP_LOCKERS)) {
      if (finalTransfer.to === addr.toLowerCase()) {
        return `🔒 Locked · ${name}`;
      }
    }

    return "🔓 Unlocked ⚠️";
  } catch {
    return "🔓 Unlocked ⚠️";
  }
}

async function checkHoneypot(tokenAddress) {
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`;
    const res = await Promise.race([
      axios.get(url, { timeout: 5000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))
    ]);
    const data = res.data?.result?.[tokenAddress.toLowerCase()];
    if (!data) return { status: "❓ Unknown", buyTax: "?", sellTax: "?", flags: [], safe: null };
    const isHoneypot     = data.is_honeypot === "1";
    const cannotSell     = data.cannot_sell_all === "1";
    const buyTax         = (parseFloat(data.buy_tax || 0) * 100).toFixed(1);
    const sellTax        = (parseFloat(data.sell_tax || 0) * 100).toFixed(1);
    const isBlacklist    = data.is_blacklisted === "1";
    const isMintable     = data.is_mintable === "1";
    const ownerCanChange = data.owner_change_balance === "1";
    if (isHoneypot || cannotSell) {
      return { status: "🚨 HONEYPOT", buyTax, sellTax, flags: ["Cannot sell"], safe: false };
    }
    const flags = [];
    if (isBlacklist)              flags.push("Blacklist");
    if (isMintable)               flags.push("Mintable");
    if (ownerCanChange)           flags.push("Owner can change balance");
    if (parseFloat(sellTax) > 10) flags.push("High sell tax");
    return { status: flags.length === 0 ? "✅ Safe" : "⚠️ Risky", buyTax, sellTax, flags, safe: flags.length === 0 };
  } catch {
    return { status: "❓ Unknown", buyTax: "?", sellTax: "?", flags: [], safe: null };
  }
}

async function checkDeployerHistory(deployerAddress) {
  try {
    const apiKey = process.env.BASESCAN_API_KEY || "";
    const url = `https://api.basescan.org/api?module=account&action=txlist&address=${deployerAddress}&sort=desc&page=1&offset=50&apikey=${apiKey}`;
    const res = await Promise.race([
      axios.get(url, { timeout: 5000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))
    ]);
    const txs = res.data?.result;
    if (!txs || !Array.isArray(txs)) return "❓ Unknown";
    const count = txs.filter(tx => tx.to === "" || tx.to === null).length;
    if (count === 0) return "🆕 First deployment";
    if (count === 1) return "📋 1 previous contract";
    return `📋 ${count} previous contracts`;
  } catch {
    return "❓ Unknown";
  }
}
// Check current pool reserves against the original liquidity amount to detect a drain
async function checkReservesDrained(provider, pairAddress, originalLiquidityUSD, isToken0New, baseDecimals, ethPriceUSD, isEth) {
  try {
    const pairAbi = ["function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
    const pair = new ethers.Contract(pairAddress, pairAbi, provider);
    const [reserve0, reserve1] = await Promise.race([
      pair.getReserves(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))
    ]);

    const baseReserveRaw = isToken0New ? reserve1 : reserve0;
    const baseReserveFloat = parseFloat(ethers.formatUnits(baseReserveRaw, baseDecimals));
    const currentLiquidityUSD = isEth ? baseReserveFloat * ethPriceUSD : baseReserveFloat;

    const original = parseFloat(String(originalLiquidityUSD).replace(/,/g, "")) || 0;
    if (original === 0) return { drained: false, currentLiquidityUSD, pctRemaining: null };

    const pctRemaining = (currentLiquidityUSD / original) * 100;
    const drained = pctRemaining < 10; // less than 10% of original liquidity left

    return { drained, currentLiquidityUSD, pctRemaining };
  } catch {
    return { drained: false, currentLiquidityUSD: null, pctRemaining: null, error: true };
  }
}

module.exports = { checkLPLock, checkHoneypot, checkDeployerHistory, checkPreLiquidityTransfers, checkReservesDrained };
