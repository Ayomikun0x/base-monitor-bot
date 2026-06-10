const { ethers } = require("ethers");
const { ERC20_ABI } = require("./constants");

// In-memory cache to avoid repeated RPC calls for same token
const tokenCache = new Map();

/**
 * Fetch token name, symbol, decimals from on-chain.
 * Returns { name, symbol, decimals } or fallback values.
 */
async function getTokenInfo(provider, address) {
  const key = address.toLowerCase();
  if (tokenCache.has(key)) return tokenCache.get(key);

  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      contract.name().catch(() => "Unknown"),
      contract.symbol().catch(() => "???"),
      contract.decimals().catch(() => 18),
    ]);

    const info = { name, symbol, decimals: Number(decimals) };
    tokenCache.set(key, info);
    return info;
  } catch {
    const fallback = { name: "Unknown", symbol: "???", decimals: 18 };
    tokenCache.set(key, fallback);
    return fallback;
  }
}

module.exports = { getTokenInfo };
