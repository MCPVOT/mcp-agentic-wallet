/** GET /api/wallet/session?token=xxx — Returns session info */
import { NextRequest, NextResponse } from 'next/server';
import { InMemoryStore, toSessionInfo } from '@mcp-agentic-wallet/core';

const store = new InMemoryStore();

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token query param' }, { status: 400 });
  }

  const session = store.getSession(token);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...toSessionInfo(session) });
}
