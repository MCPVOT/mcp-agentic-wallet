# MCP Agentic Wallet

> **Open-source EIP-2612 Permit-based wallet sessions for AI agents.**
> The reference implementation for paid MCP servers — verify signatures, manage sessions, settle on-chain. No API keys. No recurring charges.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![viem](https://img.shields.io/badge/viem-4.21.0-blue)](https://viem.sh/)
[![Base](https://img.shields.io/badge/Base-000000?logo=base&logoColor=white)](https://base.org/)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-blueviolet)](https://modelcontextprotocol.io/)

## What This Is

A human connects their crypto wallet, signs a one-time **EIP-2612 Permit** (gasless — no transaction fee), and receives a **session token**. AI agents use this token in MCP requests to pay for tool calls with USDC on Base. The server settles each call on-chain via `transferFrom`.

**No API keys. No recurring charges. No per-call wallet signatures.** The permit is the policy.

This is the reference implementation used by [mcpvot.xyz](https://mcpvot.xyz) — an x402 payment facilitator for MCP servers. The open-source core (`@mcp-agentic-wallet/core`) is framework-agnostic and works with any MCP server or Next.js app.

## Quick Start

### 1. Install the core library

```bash
npm install @mcp-agentic-wallet/core viem
```

### 2. Use in your MCP server

```typescript
import { InMemoryStore, settleCall } from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

// In your MCP tool handler:
const token = req.headers.get('Session-Token');
const session = store.getSession(token);
if (!session) return new Response('Payment required', { status: 402 });

// Consume budget ($0.005 = 5000 atomic USDC units)
const result = store.consumeBudget(token, 5000n);
if (!result.ok) return new Response('Insufficient budget', { status: 402 });

// Settle on-chain
await settleCall(session.humanAddress, 5000n, {
  treasuryAddress: process.env.TREASURY_ADDRESS!,
  hotWalletKey: process.env.HOT_WALLET_PRIVATE_KEY,
});

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

## How It Works

```
Human                          Server                        Agent
  │                              │                              │
  │── connect wallet ──────────►│                              │
  │── sign EIP-2612 Permit ───►│                              │
  │   (gasless, 1-time)           │── verify signature ──────►│ (on-chain)
  │                              │── submit permit() ────────►│ (on-chain, gas)
  │                              │── create session ──────────┐│
  │◄─ return session token ─────│◄───────────────────────────┘│
  │                              │                              │
  │                              │◄── Session-Token header ────│
  │                              │── consume budget ───────────┐│
  │                              │── transferFrom() ──────────►││ (on-chain, gas)
  │                              │── return tool data ─────────┘│
  │                              │◄──────────────────────────────│
```

## Core Library (`@mcp-agentic-wallet/core`)

| Class/Function | Description |
|---|---|
| `InMemoryStore` | Session store (in-memory, pluggable for KV/Redis) |
| `verifyPermit()` | Verifies EIP-712 Permit signature on-chain via viem |
| `settleCall()` | Executes `transferFrom(human, treasury, amount)` on Base |
| `submitPermit()` | Submits the `permit()` transaction to USDC contract |
| `checkAllowance()` | Reads on-chain USDC allowance for an owner→spender pair |
| `checkRateLimit()` | Simple rate limiter (per-wallet) |
| `toSessionInfo()` | Converts session to safe client-facing info (no permit signature) |

## Security

See [SECURITY.md](./SECURITY.md) for the full threat model.

Key features:
- **EIP-712 signature verification** — server verifies every permit signature on-chain before creating a session
- **Allowance cap** — max $100 USDC per session (configurable)
- **Deadline cap** — max 30 days
- **Rate limiting** — 5 authorizations per wallet per hour
- **Session revocation** — humans can revoke anytime
- **Settlement debt tracking** — sessions suspended after 3 failed settlements
- **Spender verification** — EIP-712 verification inherently checks `spender === treasury`

## Documentation

- **[ARCHITECTURE](./docs/ARCHITECTURE.md)** — system diagram, payment flow, design decisions
- **[MCP Integration](./docs/MCP-INTEGRATION.md)** — step-by-step guide for adding to any MCP server
- **[Security Policy](./SECURITY.md)** — threat model, attack vectors, production checklist
- **[Contributing](./CONTRIBUTING.md)** — dev setup, guidelines, PR process
- **[Donations](./docs/DONATIONS.md)** — support the project

## Tech Stack

- **EIP-2612** (Permit) — gasless approval via typed data signature
- **EIP-712** — typed data signing and verification
- **USDC** (FiatTokenV2) on **Base Mainnet** (chainId 8453)
- **viem** — TypeScript Ethereum library
- **Next.js** — reference server implementation
- **Model Context Protocol** — MCP 2025-11-25 spec

## Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `TREASURY_ADDRESS` | Yes | — | Address that receives USDC payments |
| `HOT_WALLET_PRIVATE_KEY` | Yes | — | EOA private key for gas (never commit to git!) |
| `BASE_RPC_URL` | No | `https://mainnet.base.org` | Base Mainnet RPC |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Yes | — | Treasury shown in wallet UI |

## License

MIT — see [LICENSE](./LICENSE)
