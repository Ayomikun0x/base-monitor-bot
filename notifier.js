const TelegramBot = require("node-telegram-bot-api");

let bot;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  console.log("✅ Telegram bot initialized");
  return bot;
}

// Throttle: track last alert time per token to avoid spam
const alertCooldowns = new Map();
const COOLDOWN_MS = 3000; // 3 seconds between alerts for same token

async function sendAlert(message, { tokenAddress, silent = false } = {}) {
  if (!bot) return;

  // Cooldown check
  if (tokenAddress) {
    const key = `${tokenAddress}`;
    const last = alertCooldowns.get(key) || 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    alertCooldowns.set(key, Date.now());
  }

  try {
    await bot.sendMessage(CHAT_ID, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: silent,
    });
  } catch (err) {
    console.error("Telegram send error:", err.message);
  }
}

// ─────────────────────────────────────────────
// Alert Templates
// ─────────────────────────────────────────────

function alertNewToken({ name, symbol, address, deployer, txHash, dex }) {
  return sendAlert(
    `🆕 <b>NEW TOKEN DETECTED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>${name}</b> (<code>${symbol}</code>)\n` +
    `📍 <code>${address}</code>\n` +
    `🏭 DEX: ${dex}\n` +
    `👤 Deployer: <a href="https://basescan.org/address/${deployer}">${shortAddr(deployer)}</a>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">View TX</a> | <a href="https://dexscreener.com/base/${address}">DexScreener</a>`,
    { tokenAddress: address }
  );
}

function alertFirstBuy({ name, symbol, tokenAddress, pairAddress, buyer, amountIn, amountOut, valueUSD, txHash }) {
  return sendAlert(
    `🟢 <b>FIRST BUY!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>${name}</b> (<code>${symbol}</code>)\n` +
    `💰 Spent: <b>${amountIn} ETH</b> (~$${valueUSD})\n` +
    `🛒 Received: <b>${formatNumber(amountOut)} ${symbol}</b>\n` +
    `👤 Buyer: <a href="https://basescan.org/address/${buyer}">${shortAddr(buyer)}</a>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">View TX</a> | <a href="https://dexscreener.com/base/${tokenAddress}">Chart</a>`,
    { tokenAddress }
  );
}

function alertLiquidityAdded({ name, symbol, tokenAddress, pairAddress, provider, ethAmount, tokenAmount, totalLiqUSD, txHash, dex }) {
  return sendAlert(
    `💧 <b>LIQUIDITY ADDED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>${name}</b> (<code>${symbol}</code>)\n` +
    `🏦 DEX: ${dex}\n` +
    `💵 ETH Added: <b>${ethAmount} ETH</b>\n` +
    `🪙 Tokens Added: <b>${formatNumber(tokenAmount)} ${symbol}</b>\n` +
    `📊 Total Pool Value: ~<b>$${totalLiqUSD}</b>\n` +
    `👤 Provider: <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">View TX</a> | <a href="https://dexscreener.com/base/${tokenAddress}">Chart</a>`,
    { tokenAddress }
  );
}

function alertLiquidityWarning({ name, symbol, tokenAddress, pairAddress, removalPct, provider, txHash }) {
  return sendAlert(
    `⚠️ <b>LIQUIDITY REMOVAL WARNING!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>${name}</b> (<code>${symbol}</code>)\n` +
    `🚨 <b>${removalPct}%</b> of liquidity being removed!\n` +
    `👤 By: <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>\n` +
    `⚡ Act fast — possible rug incoming!\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">View TX</a> | <a href="https://dexscreener.com/base/${tokenAddress}">Chart</a>`,
    { tokenAddress }
  );
}

function alertLiquidityRemoved({ name, symbol, tokenAddress, pairAddress, provider, ethAmount, tokenAmount, removedPct, txHash }) {
  return sendAlert(
    `🔴 <b>LIQUIDITY REMOVED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>${name}</b> (<code>${symbol}</code>)\n` +
    `💸 ETH Pulled: <b>${ethAmount} ETH</b>\n` +
    `🪙 Tokens Pulled: <b>${formatNumber(tokenAmount)} ${symbol}</b>\n` +
    `📉 Removed: <b>${removedPct}%</b> of total liquidity\n` +
    `👤 By: <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">View TX</a> | <a href="https://dexscreener.com/base/${tokenAddress}">Chart</a>`,
    { tokenAddress }
  );
}

function alertStartup(watchingFactories) {
  return sendAlert(
    `🤖 <b>Base Token Monitor — ONLINE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📡 Watching ${watchingFactories} DEX factories on Base mainnet\n` +
    `✅ Monitoring: New tokens, First buys, Liquidity events\n` +
    `⏰ Started: ${new Date().toUTCString()}`
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatNumber(n) {
  if (isNaN(n)) return n;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return Number(n).toFixed(2);
}

module.exports = {
  initBot,
  sendAlert,
  alertNewToken,
  alertFirstBuy,
  alertLiquidityAdded,
  alertLiquidityWarning,
  alertLiquidityRemoved,
  alertStartup,
  shortAddr,
  formatNumber,
};
