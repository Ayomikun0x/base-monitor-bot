const { ethers } = require("ethers");
const { ERC20_ABI } = require("./constants");

const tokenCache = new Map();

async function getTokenInfo(provider, address) {
  const key = address.toLowerCase();
  if (tokenCache.has(key)) return tokenCache.get(key);

  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [name, symbol, decimals, supplyRaw] = await Promise.all([
      contract.name().catch(() => "Unknown"),
      contract.symbol().catch(() => "???"),
      contract.decimals().catch(() => 18),
      contract.totalSupply().catch(() => 0n),
    ]);

    const dec = Number(decimals);
    const totalSupply = parseFloat(ethers.formatUnits(supplyRaw, dec));
    const info = { name, symbol, decimals: dec, totalSupply };
    tokenCache.set(key, info);
    return info;
  } catch {
    const fallback = { name: "Unknown", symbol: "???", decimals: 18, totalSupply: 0 };
    tokenCache.set(key, fallback);
    return fallback;
  }
}

module.exports = { getTokenInfo };
