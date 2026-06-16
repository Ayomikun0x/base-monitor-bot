// Auto-growing blacklist of known rug deployers and symbols
const rugDeployers  = new Set();
const rugSymbols = new Set([
  "XCHAT",
  "ANTHROPIC",
  "1KTO100M",
  "OPENHUMAN",
  "VRT",
  "HODL",
  "SPACEX",
  "SPCX",
  "LIQUIDBGT",
  // Add more symbols here anytime
]);

// How quickly a removal counts as a rug (30 minutes)
const RUG_TIME_WINDOW_MS = 15 * 60 * 1000;

// Track when liquidity was added per deployer
const deployerLiquidityTime = new Map();
const deployerTokenMap      = new Map();

function isBlacklistedDeployer(deployer) {
  return rugDeployers.has(deployer.toLowerCase());
}

function isBlacklistedSymbol(symbol) {
  return rugSymbols.has(symbol.toUpperCase());
}

function trackLiquidity(deployer, tokenAddress, symbol) {
  const key = deployer.toLowerCase();
  deployerLiquidityTime.set(key, Date.now());
  deployerTokenMap.set(key, { tokenAddress, symbol });
}

function checkAndBlacklist(deployer, tokenAddress) {
  const key     = deployerLiquidityTime.get(deployer.toLowerCase());
  const addTime = key || 0;
  const elapsed = Date.now() - addTime;

  if (elapsed <= RUG_TIME_WINDOW_MS && addTime > 0) {
    // Rug confirmed — blacklist this deployer
    rugDeployers.add(deployer.toLowerCase());
    console.log("🚨 Rug detected! Blacklisted deployer: " + deployer);
    return true;
  }
  return false;
}

function addToSymbolBlacklist(symbol) {
  rugSymbols.add(symbol.toUpperCase());
  console.log("🚫 Symbol blacklisted: " + symbol);
}

function getBlacklistStats() {
  return {
    deployers: rugDeployers.size,
    symbols: rugSymbols.size,
  };
}

module.exports = {
  isBlacklistedDeployer,
  isBlacklistedSymbol,
  trackLiquidity,
  checkAndBlacklist,
  addToSymbolBlacklist,
  getBlacklistStats,
};
