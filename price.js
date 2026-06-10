const axios = require("axios");

let cachedEthPrice = 3500; // fallback default
let lastFetch = 0;
const CACHE_TTL = 60_000; // refresh every 60 seconds

async function getEthPriceUSD() {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL) return cachedEthPrice;

  try {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { timeout: 5000 }
    );
    cachedEthPrice = res.data?.ethereum?.usd || cachedEthPrice;
    lastFetch = now;
  } catch {
    // silently use cached value
  }
  return cachedEthPrice;
}

function ethToUSD(ethAmount, ethPriceUSD) {
  return (parseFloat(ethAmount) * ethPriceUSD).toFixed(2);
}

module.exports = { getEthPriceUSD, ethToUSD };
