require("dotenv").config();
const { ethers } = require("ethers");
const { initBot, alertStartup, sendAlert } = require("./notifier");
const { startMonitor } = require("./monitor");
const { getBlacklistStats } = require("./blacklist");

function validateEnv() {
  const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "BASE_RPC_WSS"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing required environment variables:", missing.join(", "));
    process.exit(1);
  }
}

function createProvider() {
  const wss = process.env.BASE_RPC_WSS;
  const provider = new ethers.WebSocketProvider(wss);

  provider.websocket.on("close", async () => {
    console.warn("WebSocket disconnected. Reconnecting in 5s...");
    setTimeout(() => main(), 5000);
  });

  provider.websocket.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  return provider;
}

async function main() {
  validateEnv();
  initBot();

  console.log("Connecting to Base mainnet via WebSocket...");
  const provider = createProvider();

  try {
    const blockNumber = await provider.getBlockNumber();
    console.log("Connected to Base mainnet — latest block: " + blockNumber);
  } catch (err) {
    console.error("Failed to connect to Base RPC:", err.message);
    setTimeout(() => main(), 5000);
    return;
  }

  const factoryCount = await startMonitor(provider);
  await alertStartup(factoryCount, getBlacklistStats());

  setInterval(async () => {
    try {
      const block = await provider.getBlockNumber();
      console.log("Heartbeat — block: " + block + " — " + new Date().toISOString());
    } catch (err) {
      console.warn("Heartbeat failed:", err.message);
    }
  }, 5 * 60 * 1000);

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await sendAlert("🛑 <b>Base Token Monitor — OFFLINE</b>").catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
