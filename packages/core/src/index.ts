/**
 * @mcp-agentic-wallet/core
 *
 * Framework-agnostic library for EIP-2612 Permit-based wallet sessions
 * for AI agents using the Model Context Protocol (MCP).
 *
 * Flow:
 *   1. Human connects wallet → signs EIP-2612 Permit (gasless, 1-time)
 *   2. Server verifies signature on-chain → creates session token
 *   3. Agent uses session token in MCP requests (Session-Token header)
 *   4. Server settles each call via transferFrom on Base
 *
 * @license MIT
 */

// Types
export type {
  WalletSession,
  PermitData,
  SettlementResult,
  ConsumeResult,
  RateLimitResult,
  SessionInfo,
  SessionListItem,
} from './types.js';

// Store
export type { SessionStore } from './store.js';
export { InMemoryStore, toSessionInfo } from './store.js';

// Verification
export { verifyPermit, checkAllowance } from './verify.js';
export type { VerifyPermitParams, VerifyPermitResult } from './verify.js';

// Settlement
export { submitPermit, settleCall } from './settle.js';
export type { SettlementConfig } from './settle.js';

// Constants
export {
  BASE_CHAIN_ID,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ONE_USDC,
  PERMIT_DOMAIN,
  PERMIT_TYPES,
  USDC_ABI,
  NONCES_SELECTOR,
  BALANCE_OF_SELECTOR,
} from './constants.js';
