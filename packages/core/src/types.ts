/**
 * Core type definitions for the MCP Agentic Wallet.
 */

/** A human-approved spending session */
export interface WalletSession {
  /** Unique session token (Bearer token the agent sends) */
  sessionToken: string;
  /** Human's wallet address that signed the permit (lowercase) */
  humanAddress: string;
  /** Total allowance in USDC atomic units (1 USDC = 1_000_000) */
  allowance: bigint;
  /** Atomic units already consumed */
  used: bigint;
  /** Unix timestamp when the permit expires */
  deadline: number;
  /** Created at timestamp (unix seconds) */
  createdAt: number;
  /** Label the human gave this session (e.g. "my-agent-v1") */
  label: string;
  /** The raw EIP-2612 permit data + signature for on-chain settlement */
  permit: PermitData;
  /** Number of failed settlement attempts — session suspended at 3 */
  settlementFailures: number;
  /** True if session is suspended (settlement failures exceeded threshold) */
  suspended: boolean;
}

/** EIP-2612 Permit data + signature */
export interface PermitData {
  owner: string;
  spender: string;
  value: bigint;
  deadline: number;
  signature: `0x${string}`;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

/** Result of a settlement attempt */
export interface SettlementResult {
  ok: boolean;
  txHash?: string;
  gasCost?: string;
  error?: string;
}

/** Result of budget consumption */
export interface ConsumeResult {
  ok: boolean;
  remaining: bigint;
  reason?: string;
}

/** Result of rate limit check */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Session info safe to return to clients (no permit signature) */
export interface SessionInfo {
  sessionToken: string;
  humanAddress: string;
  allowance: string;
  used: string;
  remaining: string;
  deadline: number;
  label: string;
  createdAt: number;
  expired: boolean;
  suspended: boolean;
  settlementFailures: number;
}

/** Session list item (minimal) */
export interface SessionListItem {
  token: string;
  label: string;
  human: string;
  used: string;
  allowance: string;
}
