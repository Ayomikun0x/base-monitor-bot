// ─────────────────────────────────────────────────────────────
// ABIs & Contract Addresses for Base Chain
// ─────────────────────────────────────────────────────────────

// Uniswap V2 (and forks like BaseSwap, SwapBased, etc.)
const UNISWAP_V2_FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];

const UNISWAP_V2_PAIR_ABI = [
  "event Mint(address indexed sender, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1Out, uint256 amount1In, uint256 amount0Out, address indexed to)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
];

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

// Uniswap V3 (Base)
const UNISWAP_V3_FACTORY_ABI = [
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
];

const UNISWAP_V3_POOL_ABI = [
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// ─────────────────────────────────────────────────────────────
// Known Contract Addresses on Base Mainnet
// ─────────────────────────────────────────────────────────────
const ADDRESSES = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",

  // Uniswap V2 style factories on Base
  UNISWAP_V2_FACTORY: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
  BASESWAP_FACTORY:   "0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB",
  SWAPBASED_FACTORY:  "0x04C9f118d21e8B767D2e50C946f0cC9F6C367300",
  ROCKETSWAP_FACTORY: "0x1B8128c3A1B7D20053D10763ff02466ca7FF5500",

  // Uniswap V3 on Base
  UNISWAP_V3_FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  AERODROME_FACTORY:  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
};

// Pairs to watch — based on PAIR_FILTER env var (ETH | USDC | BOTH)
// Your setting: BOTH (ETH/WETH and USDC pairs only)
const PAIR_FILTER = (process.env.PAIR_FILTER || "BOTH").toUpperCase();

const ETH_TOKENS  = new Set([ADDRESSES.WETH.toLowerCase()]);
const USDC_TOKENS = new Set([ADDRESSES.USDC.toLowerCase()]);

// BASE_TOKENS = the "known" side of a pair we care about
const BASE_TOKENS = new Set([
  ...(PAIR_FILTER === "ETH"  ? ETH_TOKENS  : []),
  ...(PAIR_FILTER === "USDC" ? USDC_TOKENS : []),
  ...(PAIR_FILTER === "BOTH" ? [...ETH_TOKENS, ...USDC_TOKENS] : []),
]);

// All V2-style factories to watch
const V2_FACTORIES = [
  { address: ADDRESSES.UNISWAP_V2_FACTORY, name: "Uniswap V2" },
  { address: ADDRESSES.BASESWAP_FACTORY,   name: "BaseSwap" },
  { address: ADDRESSES.SWAPBASED_FACTORY,  name: "SwapBased" },
  { address: ADDRESSES.ROCKETSWAP_FACTORY, name: "RocketSwap" },
];

const V3_FACTORIES = [
  { address: ADDRESSES.UNISWAP_V3_FACTORY, name: "Uniswap V3" },
  { address: ADDRESSES.AERODROME_FACTORY,  name: "Aerodrome" },
];

module.exports = {
  UNISWAP_V2_FACTORY_ABI,
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  ERC20_ABI,
  ADDRESSES,
  BASE_TOKENS,
  ETH_TOKENS,
  USDC_TOKENS,
  PAIR_FILTER,
  V2_FACTORIES,
  V3_FACTORIES,
};
