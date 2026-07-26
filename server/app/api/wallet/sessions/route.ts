/** GET /api/wallet/sessions — List all sessions (dev-only) */
import { NextResponse } from 'next/server';
import { InMemoryStore } from '@mcp-agentic-wallet/core';

export const dynamic = 'force-dynamic';

const store = new InMemoryStore();

export async function GET() {
  return NextResponse.json({ ok: true, sessions: store.listSessions() });
}
