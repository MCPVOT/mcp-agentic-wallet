/**
 * Constants for EIP-2612 Permit + USDC on Base Mainnet.
 *
 * These are chain-specific constants needed for EIP-712 typed data
 * verification and on-chain settlement. They are NOT configurable —
 * they are facts about the USDC contract on Base.
 */

/** Base Mainnet chain ID */
export const BASE_CHAIN_ID = 8453;

/** USDC (FiatTokenV2) contract address on Base Mainnet */
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

/** USDC decimals (6) */
export const USDC_DECIMALS = 6;

/** 1 USDC in atomic units */
export const ONE_USDC = 1_000_000n;

/** EIP-712 domain for USDC FiatTokenV2 Permit */
export const PERMIT_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: BASE_CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
} as const;

/** EIP-712 types for EIP-2612 Permit */
export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** USDC ABI snippets for permit, transferFrom, allowance, nonces */
export const USDC_ABI = [
  {
    type: 'function',
    name: 'permit',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

/** Nonces function selector (keccak256("nonces(address)") first 4 bytes) */
export const NONCES_SELECTOR = '0x7ecebe00';

/** BalanceOf function selector (keccak256("balanceOf(address)") first 4 bytes) */
export const BALANCE_OF_SELECTOR = '0x70a08231';
