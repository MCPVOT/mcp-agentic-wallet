# MCP Agentic Wallet

> Open-source EIP-2612 Permit-based wallet sessions for AI agents using the Model Context Protocol.

## What This Is

A human connects their crypto wallet, signs a one-time **EIP-2612 Permit** (gasless — no transaction fee), and receives a **session token**. AI agents use this token in MCP requests to pay for tool calls with USDC on Base. The server settles each call on-chain via `transferFrom`.

**No API keys. No recurring charges. No per-call wallet signatures.** The permit is the policy.

## How It Works

```
Human                          Server                        Agent
  │                              │                              │
  │── connect wallet ───────────►│                              │
  │── sign EIP-2612 Permit ─────►│                              │
  │   (gasless, 1-time)          │── verify signature ────────► │ (on-chain)
  │                              │── submit permit() ──────────► │ (on-chain, gas)
  │                              │── create session ──────────┐  │
  │◄─ return session token ──────│◄──────────────────────────┘  │
  │                              │                              │
  │                              │◄── Session-Token header ─────│
  │                              │── consume budget ───────────┐ │
  │                              │── transferFrom() ─────────►│ │ (on-chain, gas)
  │                              │── return tool data ─────────┘ │
  │                              │◄─────────────────────────────│
```

## Quick Start

### 1. Install the core library

```bash
npm install @mcp-agentic-wallet/core viem
```

### 2. Use in your MCP server

```typescript
import { InMemoryStore, verifyPermit, settleCall } from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

// In your MCP tool handler:
const token = req.headers.get('Session-Token');
const session = store.getSession(token);
if (!session) return new Response('Payment required', { status: 402 });

// Consume budget
const result = store.consumeBudget(token, 5000n); // $0.005 USDC
if (!result.ok) return new Response('Insufficient budget', { status: 402 });

// Settle on-chain
await settleCall(session.humanAddress, 5000n, {
  treasuryAddress: '0x...',
  hotWalletKey: process.env.HOT_WALLET_PRIVATE_KEY,
});

// Return tool data
return Response.json({ result: 'your data' });
```

### 3. Run the reference server

```bash
git clone https://github.com/MCPVOT/mcp-agentic-wallet.git
cd mcp-agentic-wallet
npm install
cp .env.example .env.local  # Configure your treasury + hot wallet key
npm run dev
```

Visit `http://localhost:3000/wallet` to connect a wallet and authorize a session.

## Architecture

```
packages/core/          Framework-agnostic library (@mcp-agentic-wallet/core)
  src/
    constants.ts        USDC address, EIP-712 domain, ABI snippets
    types.ts            TypeScript interfaces
    store.ts            Session store (in-memory + pluggable interface)
    verify.ts           EIP-2612 Permit signature verification
    settle.ts           on-chain settlement (permit + transferFrom)
    index.ts            Public API exports

server/                 Reference Next.js app
  app/
    wallet/page.tsx     Generic wallet UI (no branding)
    api/wallet/
      authorize/        POST — verify permit, create session
      session/          GET — query session status
      sessions/         GET — list sessions (dev)
      revoke/           POST — revoke session

middleware/             Drop-in MCP middleware
  withSessionToken.ts  Session-Token header verification
```

## Security

See [SECURITY.md](./SECURITY.md) for the full threat model and [docs/SECURITY.md](./docs/SECURITY.md) for attack vectors and mitigations.

Key points:
- **EIP-712 signature verification** — server verifies every permit signature on-chain before creating a session
- **Allowance cap** — max $100 USDC per session (configurable)
- **Deadline cap** — max 30 days
- **Rate limiting** — 5 authorizations per wallet per hour
- **Session revocation** — humans can revoke anytime
- **Settlement debt tracking** — sessions suspended after 3 failed settlements

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `TREASURY_ADDRESS` | Yes | — | Address that receives USDC payments |
| `HOT_WALLET_PRIVATE_KEY` | Yes | — | EOA private key for gas (permit + transferFrom) |
| `BASE_RPC_URL` | No | `https://mainnet.base.org` | Base Mainnet RPC |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Yes | — | Treasury address shown in wallet UI |

⚠️ **Never commit private keys to git.** Use environment variables only.

## Tech Stack

- **EIP-2612** (Permit) — gasless approval via typed data signature
- **EIP-712** — typed data signing and verification
- **USDC** (FiatTokenV2) on **Base Mainnet** (chainId 8453)
- **viem** — TypeScript Ethereum library
- **Next.js** — reference server implementation
- **Model Context Protocol** — MCP 2025-11-25 spec

## License

MIT — see [LICENSE](./LICENSE)

## Donations

If this project helps you build paid MCP tools, consider donating:

- **ETH/Base:** `0x662741340B7c58f3fd30FD4908c6A8c0f9297d25`
- **BTC:** `bc1qsdkcummkf35ygj0syq0lz9yrnkng7ah8qqwrrk`
- **SOL:** `58EDJmtnLDoGTxMJ46MP5S933sDbiDUBVXqXV3nsmnV7`
