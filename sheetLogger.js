const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!SHEET_ID || !SERVICE_EMAIL || !PRIVATE_KEY) {
    console.warn("Google Sheets logging not configured — skipping.");
    return null;
  }

  try {
    const auth = new GoogleAuth({
      credentials: {
        client_email: SERVICE_EMAIL,
        private_key: PRIVATE_KEY,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    sheetsClient = google.sheets({ version: "v4", auth: authClient });
    console.log("Google Sheets client ready");
    return sheetsClient;
  } catch (err) {
    console.error("Failed to init Google Sheets client:", err.message);
    return null;
  }
}

// Log a token that hit 200%+ to the sheet
async function logQualifyingToken({
  name, symbol, address, deployer, dex,
  mcap, gainPct, liquidityUSD, lpStatus,
  safetyStatus, buyTax, sellTax, deployerHistory,
}) {
  try {
    const sheets = await getSheetsClient();
    if (!sheets) return;

    const row = [
      new Date().toISOString(),
      name || "Unknown",
      symbol || "???",
      address || "",
      deployer || "",
      dex || "",
      mcap || "",
      gainPct ? gainPct + "%" : "",
      liquidityUSD || "",
      lpStatus || "",
      safetyStatus || "",
      buyTax || "",
      sellTax || "",
      deployerHistory || "",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Sheet1!A:N",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    console.log("Logged to sheet: " + symbol + " at " + gainPct + "%");
  } catch (err) {
    console.error("Sheet log error:", err.message);
  }
}

module.exports = { logQualifyingToken };
