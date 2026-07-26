/**
 * POST /api/wallet/authorize
 *
 * Human connects wallet → signs EIP-2612 Permit → sends permit data here.
 * Server verifies the signature on-chain, creates a session, submits the
 * permit on-chain (best-effort), returns the session token.
 *
 * The human does NOT need to submit the permit on-chain themselves.
 * The server submits it + executes transferFrom when the agent calls tools.
 */

import { NextRequest, NextResponse } from 'next/server';
import { InMemoryStore, verifyPermit, submitPermit } from '@mcp-agentic-wallet/core';

// ─── Configuration ──────────────────────────────────────────────────
// In production, use a shared store instance (KV/Redis), not a new one per request.
const store = new InMemoryStore();

const TREASURY = (process.env.TREASURY_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`;
const HOT_WALLET_KEY = process.env.HOT_WALLET_PRIVATE_KEY;
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// Security caps
const MAX_ALLOWANCE_USDC = 100n * 1_000_000n; // $100 USDC
const MAX_DEADLINE_SECONDS = 30n * 24n * 60n * 60n; // 30 days

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { humanAddress, allowance, deadline, v, r, s, label } = body;

    // ── Validate required fields ──────────────────────────────────
    if (!humanAddress || !allowance || !deadline || v === undefined || !r || !s) {
      return NextResponse.json(
        { error: 'Missing required fields: humanAddress, allowance, deadline, v, r, s' },
        { status: 400 },
      );
    }

    const addr = (humanAddress as string).toLowerCase();
    if (!addr.startsWith('0x') || addr.length !== 42) {
      return NextResponse.json({ error: 'Invalid humanAddress' }, { status: 400 });
    }

    const allowanceBig = BigInt(allowance);
    if (allowanceBig <= 0n) {
      return NextResponse.json({ error: 'Allowance must be > 0' }, { status: 400 });
    }

    // ── Security: Allowance cap ───────────────────────────────────
    if (allowanceBig > MAX_ALLOWANCE_USDC) {
      return NextResponse.json({ error: 'Max allowance is $100 USDC' }, { status: 400 });
    }

    const deadlineNum = Number(deadline);
    if (deadlineNum <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: 'Deadline must be in the future' }, { status: 400 });
    }

    // ── Security: Deadline cap ───────────────────────────────────
    const maxDeadline = Math.floor(Date.now() / 1000) + Number(MAX_DEADLINE_SECONDS);
    if (deadlineNum > maxDeadline) {
      return NextResponse.json({ error: 'Max deadline is 30 days from now' }, { status: 400 });
    }

    // ── Security: Rate limit ─────────────────────────────────────
    const rateCheck = store.checkRateLimit(addr);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 5 authorizations per wallet per hour.' },
        { status: 429 },
      );
    }

    // ── Security: Verify EIP-712 permit signature ────────────────
    const verifyResult = await verifyPermit({
      owner: addr,
      spender: TREASURY,
      value: allowanceBig,
      deadline: deadlineNum,
      v: Number(v),
      r: r as `0x${string}`,
      s: s as `0x${string}`,
      rpcUrl: RPC_URL,
    });

    if (!verifyResult.valid) {
      return NextResponse.json(
        { error: verifyResult.error || 'Permit signature verification failed' },
        { status: 400 },
      );
    }

    // ── Create session ────────────────────────────────────────────
    const session = store.createSession({
      humanAddress: addr,
      allowance: allowanceBig,
      deadline: deadlineNum,
      label: label || undefined,
      permit: {
        owner: addr,
        spender: TREASURY,
        value: allowanceBig,
        deadline: deadlineNum,
        signature: `0x${r.slice(2)}${s.slice(2)}${Number(v).toString(16).padStart(2, '0')}` as `0x${string}`,
        v: Number(v),
        r: r as `0x${string}`,
        s: s as `0x${string}`,
      },
    });

    // ── Submit permit on-chain (best-effort) ──────────────────────
    const permitResult = await submitPermit(
      {
        owner: addr,
        spender: TREASURY,
        value: allowanceBig,
        deadline: deadlineNum,
        v: Number(v),
        r: r as `0x${string}`,
        s: s as `0x${string}`,
      },
      {
        treasuryAddress: TREASURY,
        hotWalletKey: HOT_WALLET_KEY,
        rpcUrl: RPC_URL,
      },
    );

    return NextResponse.json({
      ok: true,
      sessionToken: session.sessionToken,
      humanAddress: addr,
      allowance: allowanceBig.toString(),
      deadline: deadlineNum,
      label: session.label,
      permitSubmitted: permitResult.ok,
      permitTx: permitResult.txHash || null,
      permitError: permitResult.error || null,
      instructions: 'Set the Session-Token header on MCP requests to authorize agent spending.',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
