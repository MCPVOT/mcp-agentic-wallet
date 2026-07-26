# MCP Integration Guide

This guide shows how to add wallet session support to any MCP server.

## Option 1: Full Integration (authorize + settle)

Best for MCP server operators who want to charge for tool calls.

### Step 1: Install

```bash
npm install @mcp-agentic-wallet/core viem
```

### Step 2: Configure environment

```bash
# .env.local
TREASURY_ADDRESS=0x_your_treasury_address
HOT_WALLET_PRIVATE_KEY=0x_your_hot_wallet_private_key
BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_TREASURY_ADDRESS=0x_your_treasury_address
```

### Step 3: Add wallet API routes

Copy the routes from `server/app/api/wallet/` to your project:
- `authorize/route.ts` — creates sessions
- `session/route.ts` — query session status
- `sessions/route.ts` — list sessions (dev)
- `revoke/route.ts` — revoke sessions

### Step 4: Add the wallet UI

Copy `server/app/wallet/page.tsx` to your project. Configure `NEXT_PUBLIC_TREASURY_ADDRESS`.

### Step 5: Add session checks to your MCP tool handlers

```typescript
import { InMemoryStore, settleCall, type WalletSession } from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

// In your MCP tool handler:
export async function handleTool(req: Request) {
  const token = req.headers.get('Session-Token');
  if (!token) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session-Token required' }
    }), { status: 402 });
  }

  const session = store.getSession(token);
  if (!session || session.suspended) {
    return new Response('Session invalid or suspended', { status: 402 });
  }

  if (Math.floor(Date.now() / 1000) > session.deadline) {
    return new Response('Session expired', { status: 402 });
  }

  // Consume budget ($0.005 per call = 5000 atomic USDC units)
  const COST = 5000n;
  const result = store.consumeBudget(token, COST);
  if (!result.ok) {
    return new Response(`Budget error: ${result.reason}`, { status: 402 });
  }

  // ... execute your tool logic ...

  // Settle on-chain
  const settleResult = await settleCall(
    session.humanAddress,
    COST,
    {
      treasuryAddress: process.env.TREASURY_ADDRESS!,
      hotWalletKey: process.env.HOT_WALLET_PRIVATE_KEY,
    }
  );

  if (!settleResult.ok) {
    store.recordSettlementFailure(token);
    // Still return data — user paid (budget consumed)
    // Settlement will retry on next call or session gets suspended
  } else {
    store.recordSettlementSuccess(token);
  }

  return Response.json({ result: 'your tool data' });
}
```

## Option 2: Middleware Only (verify-only)

If you just want to check session tokens without settlement:

```typescript
import { withSessionToken, paymentRequiredResponse, InMemoryStore }
  from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

export async function POST(req: Request) {
  const result = await withSessionToken(req, { store, costPerCall: 5000n });
  if (!result) return paymentRequiredResponse();

  // result.session has humanAddress, allowance, used, etc.
  // result.consumeBudget() to deduct

  // ... your tool logic ...
  return Response.json({ data: 'result' });
}
```

## Agent Configuration

Agents configure the session token in their MCP client config:

```json
{
  "mcpServers": {
    "your-server": {
      "url": "https://your-domain.com/api/mcp",
      "headers": {
        "Session-Token": "maw_abc123..."
      }
    }
  }
}
```

## Cost Structure

| Parameter | Default | Description |
|-----------|---------|-------------|
| `costPerCall` | 5000 ($0.005) | USDC atomic units per tool call |
| `MAX_ALLOWANCE_USDC` | 100 ($100) | Max budget per session |
| `MAX_DEADLINE_SECONDS` | 2592000 (30 days) | Max session lifetime |
| Rate limit | 5/hr | Per wallet address |

## Important Notes

1. **The hot wallet needs ETH for gas.** Each `permit()` costs ~$0.01-0.03 in gas on Base. Each `transferFrom()` costs ~$0.01-0.02. Budget accordingly.

2. **Settlement is best-effort.** If `transferFrom()` fails (insufficient USDC balance, network error), the session's budget is still consumed but USDC isn't transferred. After 3 failures, the session is suspended.

3. **The on-chain permit is valid until the deadline.** Even if the session is revoked server-side, the treasury can still call `transferFrom` until the deadline expires. To fully revoke, submit a new permit with `value=0` on-chain.

4. **In-memory store loses sessions on cold start.** Use KV/Redis for production.
