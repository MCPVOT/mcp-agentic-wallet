/**
 * Drop-in MCP server middleware for Session-Token verification.
 *
 * Usage in any MCP server (Next.js API route, Express, etc.):
 *
 * ```typescript
 * import { withSessionToken, InMemoryStore } from '@mcp-agentic-wallet/core';
 *
 * const store = new InMemoryStore();
 *
 * export async function POST(req: Request) {
 *   return withSessionToken(req, store, async (session) => {
 *     // Your MCP tool handler here
 *     // session.humanAddress, session.allowance, session.used, etc.
 *     return new Response(JSON.stringify({ result: "data" }));
 *   });
 * }
 * ```
 *
 * The middleware:
 *   1. Reads the `Session-Token` header
 *   2. Validates it against the store
 *   3. Checks if session is expired or suspended
 *   4. Passes the session to your handler
 *   5. Returns 402 Payment Required if no valid session
 */

import type { SessionStore } from '@mcp-agentic-wallet/core';
import type { WalletSession } from '@mcp-agentic-wallet/core';

export interface SessionMiddlewareConfig {
  store: SessionStore;
  /** Cost per call in atomic USDC units (default: 5000 = $0.005) */
  costPerCall?: bigint;
}

export interface SessionMiddlewareResult {
  session: WalletSession;
  consumeBudget: () => { ok: boolean; remaining: bigint; reason?: string };
}

/**
 * Check a request for a valid Session-Token.
 * Returns the session if valid, or throws a 402 response.
 */
export async function withSessionToken(
  req: Request,
  config: SessionMiddlewareConfig,
): Promise<SessionMiddlewareResult | null> {
  const token = req.headers.get('Session-Token') || req.headers.get('session-token');
  if (!token) return null;

  const session = config.store.getSession(token);
  if (!session) return null;

  // Check expiry
  if (Math.floor(Date.now() / 1000) > session.deadline) return null;

  // Check suspension
  if (session.suspended) return null;

  return {
    session,
    consumeBudget: () => {
      const cost = config.costPerCall ?? 5000n;
      return config.store.consumeBudget(token, cost);
    },
  };
}

/**
 * Build a 402 Payment Required response for MCP clients.
 */
export function paymentRequiredResponse(message?: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: message || 'Payment required. Provide a valid Session-Token header or x402 payment.',
      },
    }),
    {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
