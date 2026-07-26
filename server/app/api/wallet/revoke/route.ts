/** POST /api/wallet/revoke — Revoke a session by token */
import { NextRequest, NextResponse } from 'next/server';
import { InMemoryStore } from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionToken } = body;

    if (!sessionToken || typeof sessionToken !== 'string') {
      return NextResponse.json({ error: 'Missing required field: sessionToken' }, { status: 400 });
    }

    const session = store.getSession(sessionToken);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const revoked = store.revokeSession(sessionToken);
    if (!revoked) {
      return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sessionToken, revokedAt: Math.floor(Date.now() / 1000) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
