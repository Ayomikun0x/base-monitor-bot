require("dotenv").config();
const { ethers } = require("ethers");
const { initBot, alertStartup, sendAlert } = require("./notifier");
const { startMonitor } = require("./monitor");

// ─────────────────────────────────────────────
// Validate required env vars
// ─────────────────────────────────────────────
function validateEnv() {
  const required = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "BASE_RPC_WSS",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("❌ Missing required environment variables:", missing.join(", "));
    console.error("   Copy .env.example to .env and fill in your values.");
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// Create WebSocket provider with auto-reconnect
// ─────────────────────────────────────────────
function createProvider() {
  const wss = process.env.BASE_RPC_WSS;
  const provider = new ethers.WebSocketProvider(wss);

  // Handle disconnections gracefully
  provider.websocket.on("close", async () => {
    console.warn("⚠️  WebSocket disconnected. Reconnecting in 5s...");
    await sendAlert("⚠️ <b>Bot WebSocket disconnected</b> — attempting reconnect...").catch(() => {});
    setTimeout(() => main(), 5000);
  });

  provider.websocket.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  return provider;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  validateEnv();

  // Init Telegram bot
  initBot();

  // Create provider
  console.log("🔌 Connecting to Base mainnet via WebSocket...");
  const provider = createProvider();

  // Test connection
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected to Base mainnet — latest block: ${blockNumber}`);
  } catch (err) {
    console.error("❌ Failed to connect to Base RPC:", err.message);
    process.exit(1);
  }

  // Start all monitors
  const factoryCount = await startMonitor(provider);

  // Notify Telegram we're online
  await alertStartup(factoryCount);

  // Keep process alive & log heartbeat every 5 min
  setInterval(async () => {
    try {
      const block = await provider.getBlockNumber();
      console.log(`💓 Heartbeat — block: ${block} — ${new Date().toISOString()}`);
    } catch (err) {
      console.warn("Heartbeat failed:", err.message);
    }
  }, 5 * 60 * 1000);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    await sendAlert("🛑 <b>Base Token Monitor — OFFLINE</b>").catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
