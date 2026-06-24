require("dotenv").config();
const { logQualifyingToken } = require("./sheetLogger");

async function runTest() {
  console.log("Running test log to Google Sheet...");

  await logQualifyingToken({
    name: "Test Token",
    symbol: "TEST",
    address: "0x0000000000000000000000000000000000dEaD",
    deployer: "0x0000000000000000000000000000000000dEaD",
    dex: "Test DEX",
    mcap: "100K",
    gainPct: 200,
    liquidityUSD: "5,000",
    lpStatus: "🔒 Locked",
    safetyStatus: "✅ Safe",
    buyTax: "0",
    sellTax: "0",
    deployerHistory: "Test entry",
  });

  console.log("Test complete — check your Google Sheet now.");
}

runTest();
