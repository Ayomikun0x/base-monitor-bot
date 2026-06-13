require("dotenv").config();
const { ethers } = require("ethers");
const { initBot, alertStartup, sendAlert } = require("./notifier");
const { startMonitor } = require("./monitor");

function validateEnv() {
  const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "BASE_RPC_HTTPS"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing required environment variables:", missing.join(", "));
    process.exit(1);
  }
}

async function main() {
  validateEnv();
  initBot();

  // Use HTTPS provider instead of WebSocket — works on all free tiers
  const rpcUrl = process.env.BASE_RPC_HTTPS || process.env.BASE_RPC_WSS;
  console.log("Connecting to Base mainnet via HTTPS...");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    const blockNumber = await provider.getBlockNumber();
    console.log("Connected to Base mainnet — latest block: " + blockNumber);
  } catch (err) {
    console.error("Failed to connect to Base RPC:", err.message);
    process.exit(1);
  }

  const factoryCount = await startMonitor(provider);
  await alertStartup(factoryCount);

  // Heartbeat every 5 minutes
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
