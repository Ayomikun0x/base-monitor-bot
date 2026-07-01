// Auto-growing blacklist of known rug deployers and symbols
// Plus a whitelist of known repeat-winner deployers
const rugDeployers  = new Set();
const rugSymbols    = new Set([
  "XCHAT",
  "ANTHROPIC",
  "1KTO100M",
  "OPENHUMAN",
  "VRT",
  "HODL",
  "SPACEX",
  "SPCX",
  "LIQUIDBGT",
]);

// Known repeat-winner deployer wallets — get priority alerts
const whitelistedDeployers = new Set([
  "0x68811d5ce53a2e963dc85b62773f3002f3b987b9", // SUBBD/RTX/IONX/HYPER/ALPE wallet
  "0x0e056e1b32bb363b15c36485de9ce1d244f7d700", // SUBBD/OZ/IONX/BMIC/LILPEPE wallet
]);

const RUG_TIME_WINDOW_MS = 15 * 60 * 1000;

const deployerLiquidityTime = new Map();
const deployerTokenMap      = new Map();

function isBlacklistedDeployer(deployer) {
  return rugDeployers.has(deployer.toLowerCase());
}

function isBlacklistedSymbol(symbol) {
  return rugSymbols.has(symbol.toUpperCase());
}

function isWhitelistedDeployer(deployer) {
  return whitelistedDeployers.has(deployer.toLowerCase());
}

function addToWhitelist(deployer) {
  whitelistedDeployers.add(deployer.toLowerCase());
  console.log("⭐ Deployer whitelisted: " + deployer);
}

function trackLiquidity(deployer, tokenAddress, symbol) {
  const key = deployer.toLowerCase();
  deployerLiquidityTime.set(key, Date.now());
  deployerTokenMap.set(key, { tokenAddress, symbol });
}

function checkAndBlacklist(deployer, tokenAddress) {
  const key     = deployer.toLowerCase();
  const addTime = deployerLiquidityTime.get(key) || 0;
  const elapsed = Date.now() - addTime;

  if (elapsed <= RUG_TIME_WINDOW_MS && addTime > 0) {
    rugDeployers.add(key);
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
    whitelisted: whitelistedDeployers.size,
  };
}

module.exports = {
  isBlacklistedDeployer,
  isBlacklistedSymbol,
  isWhitelistedDeployer,
  addToWhitelist,
  trackLiquidity,
  checkAndBlacklist,
  addToSymbolBlacklist,
  getBlacklistStats,
};
