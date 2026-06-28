const TelegramBot = require("node-telegram-bot-api");

let bot;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function initBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  console.log("Telegram bot initialized");
  return bot;
}

const alertCooldowns = new Map();
const COOLDOWN_MS = 500;

async function sendAlert(message, { tokenAddress, silent = false } = {}) {
  if (!bot) return;
  if (tokenAddress) {
    const last = alertCooldowns.get(tokenAddress) || 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    alertCooldowns.set(tokenAddress, Date.now());
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

function alertNewToken({ name, symbol, address, deployer, txHash, dex, deployerHistory, honeypot, preLiqRecipients }) {
  const hp = honeypot || {};
  const hpText = hp.status || "❓ Unknown";
  const taxText = (hp.buyTax && hp.buyTax !== "?") ? `  Buy ${hp.buyTax}%  Sell ${hp.sellTax}%` : "";
  const flagText = (hp.flags && hp.flags.length) ? `\n⚑  ${hp.flags.join(" · ")}` : "";

  let preLiqWarning = "";
  if (preLiqRecipients && preLiqRecipients.length > 0) {
    const list = preLiqRecipients.map(r => shortAddr(r)).join(", ");
    preLiqWarning = `\n\n🚨 <b>PRE-LIQUIDITY TRANSFERS DETECTED</b>\nDeployer sent tokens before liquidity was added:\n${list}`;
  }

  return sendAlert(
    `🆕 <b>NEW TOKEN</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  ${dex}\n\n` +
    `🍯 Safety    ${hpText}${taxText}${flagText}\n` +
    `👤 Deployer  <a href="https://basescan.org/address/${deployer}">${shortAddr(deployer)}</a>\n` +
    `📋 History   ${deployerHistory || "❓ Unknown"}\n` +
    `📍 Contract  <code>${address}</code>` +
    `${preLiqWarning}\n\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${address}">GMGN</a>  ·  <a href="https://basescan.org/token/${address}">Basescan</a>`,
    { tokenAddress: address }
  );
}

function alertLiquidityAdded({ name, symbol, tokenAddress, provider, baseAmount, baseSymbol, tokenAmount, totalLiqUSD, txHash, dex, price, mcap, lpStatus, honeypot, deployerHistory }) {
  const hp = honeypot || {};
  const hpText = hp.status ? `${hp.status}  Buy ${hp.buyTax || "?"}%  Sell ${hp.sellTax || "?"}%` : "";
  const safetyLine = hpText ? `🍯 Safety    ${hpText}\n` : "";
  const historyLine = deployerHistory ? `📋 History   ${deployerHistory}\n` : "";
  const isUnlocked = lpStatus && lpStatus.includes("Unlocked");
  const lpWarning = isUnlocked ? `\n🚨 <b>WARNING — LP UNLOCKED! Dev can rug anytime!</b>` : "";

  return sendAlert(
    `💧 <b>LIQUIDITY ADDED${isUnlocked ? " ⚠️" : ""}</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  ${dex}\n\n` +
    `💵 Added     <b>${baseAmount} ${baseSymbol}</b>\n` +
    `🪙 Tokens    ${formatNumber(tokenAmount)} ${symbol}\n` +
    `🏊 Pool      ~$${totalLiqUSD}\n` +
    `💲 Price     <b>$${price}</b>\n` +
    `📊 MCap      <b>$${mcap}</b>\n` +
    `🔐 LP        ${lpStatus || "❓ Unknown"}${lpWarning}\n` +
    `${safetyLine}` +
    `${historyLine}\n` +
    `👛 Wallet    <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>  ·  <a href="https://gmgn.ai/base/address/${provider}">GMGN</a>\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_liq" }
  );
}
function alertUSDCPair({ name, symbol, tokenAddress, provider, baseAmount, tokenAmount, totalLiqUSD, txHash, dex, price, mcap, lpStatus, honeypot, deployerHistory }) {
  const hp = honeypot || {};
  const hpText = hp.status ? `${hp.status}  Buy ${hp.buyTax || "?"}%  Sell ${hp.sellTax || "?"}%` : "";
  const safetyLine = hpText ? `🍯 Safety    ${hpText}\n` : "";
  const historyLine = deployerHistory ? `📋 History   ${deployerHistory}\n` : "";
  const isUnlocked = lpStatus && lpStatus.includes("Unlocked");
  const lpWarning = isUnlocked ? `\n🚨 <b>WARNING — LP UNLOCKED!</b>` : "";

  return sendAlert(
    `💎🔥 <b>USDC PAIR ALERT</b> 🔥💎\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  ${dex}\n\n` +
    `⚡ <b>HISTORICALLY STRONGER MOVES!</b>\n\n` +
    `💵 Added     <b>${baseAmount} USDC</b>\n` +
    `🪙 Tokens    ${formatNumber(tokenAmount)} ${symbol}\n` +
    `🏊 Pool      ~$${totalLiqUSD}\n` +
    `💲 Price     <b>$${price}</b>\n` +
    `📊 MCap      <b>$${mcap}</b>\n` +
    `🔐 LP        ${lpStatus || "❓ Unknown"}${lpWarning}\n` +
    `${safetyLine}` +
    `${historyLine}\n` +
    `👛 Wallet    <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>  ·  <a href="https://gmgn.ai/base/address/${provider}">GMGN</a>\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_usdc" }
  );
}
function alertFirstBuy({ name, symbol, tokenAddress, buyer, amountIn, baseSymbol, amountOut, valueUSD, txHash, isSnipe }) {
  const snipeTag = isSnipe ? `\n⚡ <b>SNIPE DETECTED</b> — bought within 60s of liquidity!` : "";
  return sendAlert(
    `🟢 <b>FIRST BUY${isSnipe ? " ⚡" : ""}</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  Base` +
    `${snipeTag}\n\n` +
    `💰 Spent     <b>${amountIn} ${baseSymbol}</b>  (~$${valueUSD})\n` +
    `🛒 Got       ${formatNumber(amountOut)} ${symbol}\n\n` +
    `👛 Wallet    <a href="https://basescan.org/address/${buyer}">${shortAddr(buyer)}</a>  ·  <a href="https://gmgn.ai/base/address/${buyer}">GMGN</a>\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_buy" }
  );
}

function alertLiquidityWarning({ name, symbol, tokenAddress, removalPct, provider, txHash }) {
  return sendAlert(
    `⚠️ <b>RUG WARNING</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  Base\n\n` +
    `🚨 Removing  <b>${removalPct}%</b> of liquidity!\n` +
    `⚡ Act fast!\n\n` +
    `👛 Wallet    <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>  ·  <a href="https://gmgn.ai/base/address/${provider}">GMGN</a>\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_warn" }
  );
}

function alertLiquidityRemoved({ name, symbol, tokenAddress, provider, baseAmount, baseSymbol, tokenAmount, removedPct, txHash }) {
  return sendAlert(
    `🔴 <b>LIQUIDITY REMOVED</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>  ·  Base\n\n` +
    `💸 Pulled    <b>${baseAmount} ${baseSymbol}</b>\n` +
    `🪙 Tokens    ${formatNumber(tokenAmount)} ${symbol}\n` +
    `📉 Removed   <b>${removedPct}%</b> of pool\n\n` +
    `👛 Wallet    <a href="https://basescan.org/address/${provider}">${shortAddr(provider)}</a>  ·  <a href="https://gmgn.ai/base/address/${provider}">GMGN</a>\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://basescan.org/tx/${txHash}">TX</a>  ·  <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_removed" }
  );
}

function alertPriceMilestone({ name, symbol, tokenAddress, gainPct, multiple, currentPrice, fromPrice }) {
  const emoji = gainPct >= 900 ? "🚀" : gainPct >= 200 ? "💎" : "📈";
  return sendAlert(
    `${emoji} <b>${multiple} GAIN!</b>\n\n` +
    `<b>${name}</b>  <code>$${symbol}</code>\n\n` +
    `📈 Gain      <b>${multiple}</b> since first buy\n` +
    `💲 Now       <b>$${currentPrice}</b>\n` +
    `🏁 Started   $${fromPrice}\n\n` +
    `📍 Contract  <code>${tokenAddress}</code>\n` +
    `🔗 <a href="https://gmgn.ai/base/token/${tokenAddress}">GMGN Chart</a>`,
    { tokenAddress: tokenAddress + "_milestone" }
  );
}

function alertStartup(watchingFactories, blacklistStats) {
  return sendAlert(
    `🤖 <b>Base Token Monitor — ONLINE</b>\n\n` +
    `📡 Watching ${watchingFactories} DEX factories\n` +
    `✅ ETH & USDC pairs  ·  Min liq $2,000\n` +
    `🍯 Honeypot detection enabled\n` +
    `🔐 LP lock detection enabled\n` +
    `⚡ Snipe detection enabled\n` +
    `⚠️ Rug warning detection enabled\n` +
    `🚫 High tax tokens filtered out\n` +
    `🛡️ Blacklisted symbols: ${blacklistStats?.symbols || 0}\n` +
    `🛡️ Blacklisted deployers: ${blacklistStats?.deployers || 0}\n` +
    `📈 Price milestones: 50%, 100%, 200%+\n` +
    `⏰ ${new Date().toUTCString()}`
  );
}

function shortAddr(addr) {
  if (!addr) return "Unknown";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatNumber(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return String(n);
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

module.exports = {
  initBot, sendAlert, alertNewToken, alertFirstBuy,
  alertLiquidityAdded, alertUSDCPair, alertLiquidityWarning,
  alertLiquidityRemoved, alertPriceMilestone,
  alertStartup, shortAddr, formatNumber,
};
