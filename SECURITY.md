# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue.

Email: `support@mcpvot.xyz`

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and patch critical vulnerabilities within 7 days.

## Threat Model

### Assets
- **Hot wallet private key** — can submit permit() and transferFrom() for all users
- **Session tokens** — bearer tokens that authorize agent spending
- **Permit signatures** — EIP-2612 signatures that can be replayed on-chain

### Attack Vectors

| # | Vector | Severity | Mitigation |
|---|--------|----------|------------|
| 1 | Forged permit signature | CRITICAL | Server verifies EIP-712 signature on-chain before session creation |
| 2 | Oversized allowance | MEDIUM | Server caps at $100 USDC |
| 3 | Infinite deadline | MEDIUM | Server caps at 30 days |
| 4 | Permit replay (same nonce) | HIGH | Nonce read from chain; once permit() is submitted, nonce changes |
| 5 | Session token theft | MEDIUM | Revocation endpoint; short-lived sessions (30 day max) |
| 6 | Gas draining (flood authorize) | MEDIUM | Rate limited: 5 per wallet per hour |
| 7 | Settlement failure spam | MEDIUM | Sessions suspended after 3 failed settlements |
| 8 | Wrong spender in permit | CRITICAL | EIP-712 verification checks spender === treasury |
| 9 | CORS / phishing | MEDIUM | Document origin restrictions; authorize endpoint should check Referer |
| 10 | In-memory store cold start | HIGH | Use KV/Redis for production (documented limitation) |

### Hot Wallet Security

The hot wallet is a **single-purpose EOA** with minimal ETH for gas.
- Never use it for anything else
- Keep only enough ETH for ~1 week of gas
- Rotate the key periodically
- Monitor the address on BaseScan

If the hot wallet key is compromised:
1. Transfer all USDC to a new treasury immediately
2. Generate a new hot wallet key
3. Update env vars and redeploy
4. All existing sessions become invalid (permit spender changes)

## Security Checklist for Production Deployments

- [ ] `HOT_WALLET_PRIVATE_KEY` set via hosting env vars (never in code)
- [ ] `TREASURY_ADDRESS` matches your receiving wallet
- [ ] Hot wallet has enough ETH for gas (~0.01 ETH/month)
- [ ] Production uses KV/Redis for session persistence (not in-memory)
- [ ] CORS configured on /authorize endpoint
- [ ] Rate limiting enabled
- [ ] TLS/HTTPS enforced
- [ ] Monitor settlement failures (sessions should not be silently failing)
