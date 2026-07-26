# Contributing

## Development Setup

```bash
git clone https://github.com/MCPVOT/mcp-agentic-wallet.git
cd mcp-agentic-wallet
npm install
cp .env.example .env.local
# Edit .env.local with your treasury address and hot wallet key
npm run dev
```

## Project Structure

- `packages/core/` — `@mcp-agentic-wallet/core` library (framework-agnostic)
- `server/` — Reference Next.js app with wallet UI + API routes
- `middleware/` — Drop-in MCP middleware
- `docs/` — Documentation

## Guidelines

1. **Security first** — this project handles real money. Review every change for attack vectors.
2. **No branding** — the core library and reference UI must stay brand-neutral. Forks add their own branding.
3. **No secrets in code** — private keys go in environment variables, never in source.
4. **Test before PR** — verify `npm run build` and `npm run lint` pass.
5. **Document changes** — update docs when adding features.

## Pull Request Process

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit with clear messages
4. Ensure build + lint pass
5. Open PR with a description of what changed and why

## Code Style

- TypeScript strict mode
- No `any` types — use `unknown` + type guards
- BigInt for all on-chain values (never `number`)
- `0x${string}` for addresses
- Explicit exports (no `export *`)
