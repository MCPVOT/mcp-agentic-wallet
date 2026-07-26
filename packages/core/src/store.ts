/**
 * Session store — pluggable interface for persisting wallet sessions.
 *
 * Default: in-memory Map (lost on cold start — dev only).
 * Production: implement with Vercel KV, Redis, or any KV store.
 */

import type {
  WalletSession,
  SessionInfo,
  SessionListItem,
  ConsumeResult,
  RateLimitResult,
} from './types.js';

export interface SessionStore {
  getSession(token: string): WalletSession | undefined;
  createSession(params: {
    humanAddress: string;
    allowance: bigint;
    deadline: number;
    label?: string;
    permit: WalletSession['permit'];
  }): WalletSession;
  consumeBudget(token: string, amount: bigint): ConsumeResult;
  revokeSession(token: string): boolean;
  listSessions(): SessionListItem[];
  recordSettlementFailure(token: string): { suspended: boolean; failures: number };
  recordSettlementSuccess(token: string): void;
  checkRateLimit(walletAddress: string): RateLimitResult;
}

// ─── In-memory implementation (dev/default) ────────────────────────

import { randomBytes } from 'node:crypto';

const MAX_SETTLEMENT_FAILURES = 3;
const RATE_WINDOW_MS = 3600_000; // 1 hour
const RATE_MAX = 5;

function generateToken(): string {
  return 'maw_' + randomBytes(24).toString('hex');
}

export class InMemoryStore implements SessionStore {
  private sessions = new Map<string, WalletSession>();
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();

  getSession(token: string): WalletSession | undefined {
    return this.sessions.get(token);
  }

  createSession(params: {
    humanAddress: string;
    allowance: bigint;
    deadline: number;
    label?: string;
    permit: WalletSession['permit'];
  }): WalletSession {
    const session: WalletSession = {
      sessionToken: generateToken(),
      humanAddress: params.humanAddress.toLowerCase(),
      allowance: params.allowance,
      used: 0n,
      deadline: params.deadline,
      createdAt: Math.floor(Date.now() / 1000),
      label: params.label || 'unnamed session',
      permit: params.permit,
      settlementFailures: 0,
      suspended: false,
    };
    this.sessions.set(session.sessionToken, session);
    return session;
  }

  consumeBudget(token: string, amount: bigint): ConsumeResult {
    const session = this.sessions.get(token);
    if (!session) return { ok: false, remaining: 0n, reason: 'session_not_found' };
    if (Math.floor(Date.now() / 1000) > session.deadline)
      return { ok: false, remaining: session.allowance - session.used, reason: 'session_expired' };
    if (session.suspended)
      return { ok: false, remaining: session.allowance - session.used, reason: 'session_suspended' };

    const remaining = session.allowance - session.used;
    if (remaining < amount)
      return { ok: false, remaining, reason: 'insufficient_budget' };

    session.used += amount;
    return { ok: true, remaining: session.allowance - session.used };
  }

  revokeSession(token: string): boolean {
    return this.sessions.delete(token);
  }

  listSessions(): SessionListItem[] {
    return Array.from(this.sessions.entries()).map(([token, s]) => ({
      token,
      label: s.label,
      human: s.humanAddress,
      used: s.used.toString(),
      allowance: s.allowance.toString(),
    }));
  }

  recordSettlementFailure(token: string): { suspended: boolean; failures: number } {
    const session = this.sessions.get(token);
    if (!session) return { suspended: false, failures: 0 };
    session.settlementFailures++;
    if (session.settlementFailures >= MAX_SETTLEMENT_FAILURES) {
      session.suspended = true;
      return { suspended: true, failures: session.settlementFailures };
    }
    return { suspended: false, failures: session.settlementFailures };
  }

  recordSettlementSuccess(token: string): void {
    const session = this.sessions.get(token);
    if (session) session.settlementFailures = 0;
  }

  checkRateLimit(walletAddress: string): RateLimitResult {
    const now = Date.now();
    const entry = this.rateBuckets.get(walletAddress);
    if (!entry || now > entry.resetAt) {
      this.rateBuckets.set(walletAddress, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return { allowed: true, remaining: RATE_MAX - 1, resetAt: now + RATE_WINDOW_MS };
    }
    if (entry.count >= RATE_MAX) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    entry.count++;
    return { allowed: true, remaining: RATE_MAX - entry.count, resetAt: entry.resetAt };
  }
}

/** Convert a session to safe client-facing info (no permit signature) */
export function toSessionInfo(session: WalletSession): SessionInfo {
  const remaining = session.allowance - session.used;
  return {
    sessionToken: session.sessionToken,
    humanAddress: session.humanAddress,
    allowance: session.allowance.toString(),
    used: session.used.toString(),
    remaining: remaining.toString(),
    deadline: session.deadline,
    label: session.label,
    createdAt: session.createdAt,
    expired: Math.floor(Date.now() / 1000) > session.deadline,
    suspended: session.suspended,
    settlementFailures: session.settlementFailures,
  };
}
