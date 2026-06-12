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

async function checkLPLock(provider, pairAddress, txHash) {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return "❓ Unknown";
    const iface = new ethers.Interface(TRANSFER_ABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pairAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "Transfer") {
          const to = parsed.args.to.toLowerCase();
          for (const [addr, name] of Object.entries(LP_LOCKERS)) {
            if (to === addr.toLowerCase()) return `🔒 Locked · ${name}`;
          }
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 15000));
    for (let i = 1; i <= 5; i++) {
      try {
        const block = await provider.getBlock(receipt.blockNumber + i, true);
        if (!block || !block.transactions) continue;
        for (const tx of block.transactions) {
          if (!tx.to) continue;
          const to = tx.to.toLowerCase();
          for (const [addr, name] of Object.entries(LP_LOCKERS)) {
            if (to === addr.toLowerCase()) {
              const lockReceipt = await provider.getTransactionReceipt(tx.hash);
              if (!lockReceipt) continue;
              for (const log of lockReceipt.logs) {
                if (log.address.toLowerCase() === pairAddress.toLowerCase()) {
                  return `🔒 Locked · ${name}`;
                }
              }
            }
          }
        }
      } catch {}
    }
    return "🔓 Unlocked ⚠️";
  } catch {
    return "❓ Unknown";
  }
}

async function checkHoneypot(tokenAddress) {
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`;
    const res = await axios.get(url, { timeout: 8000 });
    const data = res.data?.result?.[tokenAddress.toLowerCase()];
    if (!data) return { status: "❓ Unknown", buyTax: "?", sellTax: "?", flags: [], safe: null };

    const isHoneypot    = data.is_honeypot === "1";
    const cannotSell    = data.cannot_sell_all === "1";
    const buyTax        = (parseFloat(data.buy_tax || 0) * 100).toFixed(1);
    const sellTax       = (parseFloat(data.sell_tax || 0) * 100).toFixed(1);
    const isBlacklist   = data.is_blacklisted === "1";
    const isMintable    = data.is_mintable === "1";
    const ownerCanChange = data.owner_change_balance === "1";

    if (isHoneypot || cannotSell) {
      return { status: "🚨 HONEYPOT", buyTax, sellTax, flags: ["Cannot sell"], safe: false };
    }

    const flags = [];
    if (isBlacklist)     flags.push("Blacklist");
    if (isMintable)      flags.push("Mintable");
    if (ownerCanChange)  flags.push("Owner can change balance");
    if (parseFloat(sellTax) > 10) flags.push("High sell tax");

    return {
      status: flags.length === 0 ? "✅ Safe" : "⚠️ Risky",
      buyTax, sellTax, flags,
      safe: flags.length === 0,
    };
  } catch {
    return { status: "❓ Unknown", buyTax: "?", sellTax: "?", flags: [], safe: null };
  }
}

async function checkDeployerHistory(deployerAddress) {
  try {
    const apiKey = process.env.BASESCAN_API_KEY || "";
    const url = `https://api.basescan.org/api?module=account&action=txlist&address=${deployerAddress}&sort=desc&page=1&offset=50&apikey=${apiKey}`;
    const res = await axios.get(url, { timeout: 8000 });
    const txs = res.data?.result;
    if (!txs || !Array.isArray(txs)) return "❓ Unknown";
    const deployments = txs.filter(tx => tx.to === "" || tx.to === null);
    const count = deployments.length;
    if (count === 0) return "🆕 First deployment";
    if (count === 1) return "📋 1 previous contract";
    return `📋 ${count} previous contracts`;
  } catch {
    return "❓ Unknown";
  }
}

module.exports = { checkLPLock, checkHoneypot, checkDeployerHistory };
