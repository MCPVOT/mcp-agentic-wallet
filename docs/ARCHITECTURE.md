# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Human Wallet                           │
│  (MetaMask, Coinbase Wallet, etc.)                          │
│                                                             │
│  1. Connect to Base Mainnet                                 │
│  2. Sign EIP-2612 Permit (gasless)                         │
│     - owner: human address                                  │
│     - spender: treasury address                             │
│     - value: allowance in USDC atomic units                 │
│     - nonce: from USDC contract nonces(owner)               │
│     - deadline: now + 30 days                               │
└────────────────────────┬────────────────────────────────────┘
                         │  v, r, s (permit signature)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Server (Next.js)                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  /api/wallet/authorize                              │    │
│  │  1. Validate fields (address, allowance, deadline)  │    │
│  │  2. Check allowance cap ($100)                       │    │
│  │  3. Check deadline cap (30 days)                     │    │
│  │  4. Rate limit (5/hr per wallet)                     │    │
│  │  5. Read nonce from USDC contract                    │    │
│  │  6. Verify EIP-712 signature (verifyTypedData)       │    │
│  │  7. Create session token                             │    │
│  │  8. Submit permit() on-chain (best-effort)            │    │
│  │  9. Return session token to human                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Session Store (Map / KV / Redis)                   │    │
│  │  token → { humanAddress, allowance, used, deadline, │    │
│  │            permit(v,r,s), settlementFailures }      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  MCP Tool Handler                                   │    │
│  │  1. Check Session-Token header                      │    │
│  │  2. Validate session (not expired/suspended)       │    │
│  │  3. Consume budget (allowance - used >= cost)       │    │
│  │  4. Execute tool logic                              │    │
│  │  5. Settle on-chain: transferFrom(human, treasury)  │    │
│  │  6. Record settlement result                        │    │
│  │  7. Return tool data                                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         │  Session-Token header
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     AI Agent (MCP Client)                   │
│                                                             │
│  "Session-Token: maw_abc123..."                             │
│  → calls MCP tools without wallet or private keys           │
└─────────────────────────────────────────────────────────────┘
```

## Payment Flow (EIP-2612)

1. **Permit signing** (gasless): The human signs an EIP-712 typed data message off-chain. No ETH needed, no transaction fee. This is the key UX advantage — the human doesn't pay gas for approval.

2. **Permit submission** (gas): The server calls `permit(owner, spender, value, deadline, v, r, s)` on the USDC contract. This sets the on-chain allowance. The server's hot wallet pays gas.

3. **Settlement** (gas): For each tool call, the server calls `transferFrom(human, treasury, amount)` to move USDC from the human's wallet to the treasury. The hot wallet pays gas again.

## Key Design Decisions

### Why EIP-2612 (Permit) instead of x402 (ERC-3009)?

| Aspect | EIP-2612 (this project) | ERC-3009 (x402) |
|--------|------------------------|------------------|
| Who signs | Human, 1-time | Agent, per-call |
| On-chain tx | 2 (permit + transferFrom) | 1 (transferWithAuthorization) |
| Nonce | Sequential (chain-managed) | Random (sender-chosen) |
| Session model | Stateful (budget tracking) | Stateless (per-call) |
| Gas paid by | Server (hot wallet) | Agent |
| UX | Human signs once, agent runs free | Agent signs every call |

### Why in-memory store is default (and why you shouldn't use it in prod)

In-memory `Map()` is simple and has zero dependencies. But on Vercel serverless:
- Every cold start wipes all sessions
- Budget tracking resets (users could overspend by timing cold starts)
- Session tokens become invalid unpredictably

**Production:** implement `SessionStore` interface with Vercel KV or Redis.

### Why $100 allowance cap

Prevents a user from signing a permit for an absurd amount (e.g., $1M) that, if the on-chain permit is submitted, gives the treasury unlimited claim on future deposits. $100 is enough for 10K-20K tool calls at $0.005-$0.01 each.

## Session Lifecycle

```
Created ──► Active ──► Expired (deadline passed)
              │
              ├──► Suspended (3 settlement failures)
              │
              └──► Revoked (human or admin)
```

- **Active:** Agent can call tools, budget is consumed, settlement runs
- **Expired:** Permit deadline passed, session no longer valid
- **Suspended:** 3 consecutive settlement failures, session frozen
- **Revoked:** Human revoked via /revoke endpoint, token invalid immediately
