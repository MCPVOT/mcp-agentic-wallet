'use client';

import { useState, useCallback } from 'react';

/**
 * Generic Agentic Wallet UI
 *
 * A reference wallet connection page that:
 *   1. Connects to MetaMask / Coinbase Wallet
 *   2. Switches to Base Mainnet
 *   3. Signs an EIP-2612 Permit (gasless, 1-time)
 *   4. Submits to the server's /api/wallet/authorize
 *   5. Returns a session token for MCP agent config
 *
 * No branding — fork this for your own project.
 */

const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = '0x2105';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Treasury address — configure via env or hardcode for your deployment
const TREASURY = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const PERMIT_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: BASE_CHAIN_ID,
  verifyingContract: USDC_BASE,
} as const;

// keccak256 selectors
const BALANCE_OF_SEL = '0x70a08231';
const NONCES_SEL = '0x7ecebe00';

async function rpcCall(method: string, params: unknown[]): Promise<string> {
  const res = await fetch('https://mainnet.base.org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || json.error.code);
  return json.result;
}

export default function WalletPage() {
  const [address, setAddress] = useState<string>('');
  const [balance, setBalance] = useState<string>('...');
  const [balanceRaw, setBalanceRaw] = useState<bigint>(0n);
  const [isConnected, setIsConnected] = useState(false);
  const [chainOk, setChainOk] = useState(false);
  const [allowanceUSD, setAllowanceUSD] = useState('5');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [step, setStep] = useState<'connect' | 'nonce' | 'sign' | 'submit' | 'done' | 'error'>('connect');
  const [status, setStatus] = useState<string>('');
  const [permitTx, setPermitTx] = useState<string>('');
  const [error, setError] = useState<string>('');

  // ── Connect wallet ──────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('No wallet detected. Install MetaMask or Coinbase Wallet.');
      return;
    }
    setStep('connect');
    setError('');

    try {
      const accounts: string[] = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      if (!accounts || !accounts[0]) throw new Error('No accounts returned');

      // Force Base Mainnet
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_CHAIN_ID_HEX }],
        });
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number }).code;
        if (code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_CHAIN_ID_HEX,
              chainName: 'Base Mainnet',
              rpcUrls: ['https://mainnet.base.org'],
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: ['https://basescan.org'],
            }],
          });
        } else {
          throw new Error('Please switch your wallet to Base Mainnet.');
        }
      }

      const chainId: string = await window.ethereum.request({ method: 'eth_chainId' });
      if (parseInt(chainId, 16) !== BASE_CHAIN_ID) {
        throw new Error(`Wrong network. Expected Base (${BASE_CHAIN_ID}), got ${parseInt(chainId, 16)}`);
      }

      setAddress(accounts[0].toLowerCase());
      setIsConnected(true);
      setChainOk(true);
      setStep('nonce');
      fetchBalance(accounts[0].toLowerCase());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      setError(msg);
      setStep('error');
    }
  }, []);

  const fetchBalance = useCallback(async (owner: string) => {
    try {
      const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
      const result = await rpcCall('eth_call', [{ to: USDC_BASE, data }, 'latest']);
      const bal = BigInt(result || '0x0');
      setBalanceRaw(bal);
      const balFormatted = Number(bal) / 1_000_000;
      setBalance(balFormatted.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }));
    } catch {
      setBalance('ERROR');
    }
  }, []);

  // ── Sign EIP-2612 Permit ────────────────────────────────────────
  const authorize = useCallback(async () => {
    if (!address || !window.ethereum || !chainOk) return;
    setError('');
    setSessionToken('');

    const usdAmount = parseFloat(allowanceUSD);
    if (isNaN(usdAmount) || usdAmount < 0.01) {
      setError('Minimum allowance is $0.01 USDC.');
      return;
    }

    if (balanceRaw < BigInt(Math.floor(usdAmount * 1_000_000))) {
      setError(`Insufficient USDC balance. You have ${balance}, need at least $${allowanceUSD}.`);
      return;
    }

    try {
      const owner = address as `0x${string}`;
      const deadline = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const allowanceAtomic = BigInt(Math.floor(usdAmount * 1_000_000));

      // Step 1: Read nonce
      setStep('nonce');
      setStatus('Reading permit nonce from USDC contract...');
      const nonceData = NONCES_SEL + owner.slice(2).padStart(64, '0');
      const nonceRaw = await rpcCall('eth_call', [{ to: USDC_BASE, data: nonceData }, 'latest']);
      const nonce = BigInt(nonceRaw || '0x0');
      setStatus(`Nonce: ${nonce.toString()}`);

      // Step 2: Sign
      setStep('sign');
      setStatus('Waiting for wallet signature...\n\nReview the permit in your wallet before signing.');

      const message = {
        owner,
        spender: TREASURY,
        value: allowanceAtomic.toString(),
        nonce: nonce.toString(),
        deadline,
      };

      const signature: string = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [
          address,
          JSON.stringify({
            domain: PERMIT_DOMAIN,
            types: PERMIT_TYPES,
            primaryType: 'Permit',
            message,
          }),
        ],
      });

      const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
      const r = '0x' + sig.slice(0, 64);
      const s = '0x' + sig.slice(64, 128);
      const v = parseInt(sig.slice(128, 130), 16);

      // Step 3: Submit
      setStep('submit');
      setStatus('Submitting authorization to server...');

      const res = await fetch('/api/wallet/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          humanAddress: address,
          allowance: allowanceAtomic.toString(),
          deadline,
          v,
          r,
          s,
          label: 'wallet-ui',
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Authorization failed');

      setSessionToken(data.sessionToken);
      setPermitTx(data.permitTx || '');
      setStep('done');
      setStatus(data.permitSubmitted
        ? '✅ Permit submitted on-chain. Session active.'
        : `✅ Session created (on-chain settlement: ${data.permitError || 'pending'})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Authorization failed';
      setError(msg);
      setStep('error');
      setStatus('');
    }
  }, [address, allowanceUSD, balanceRaw, balance, chainOk]);

  const copyToken = () => {
    if (sessionToken) {
      navigator.clipboard.writeText(sessionToken);
      setStatus('📋 Token copied!');
    }
  };

  const disconnect = () => {
    setAddress('');
    setBalance('...');
    setBalanceRaw(0n);
    setIsConnected(false);
    setChainOk(false);
    setSessionToken('');
    setPermitTx('');
    setStatus('');
    setError('');
    setStep('connect');
  };

  const revoke = useCallback(async () => {
    if (!sessionToken) return;
    setError('');
    setStatus('Revoking session...');
    try {
      const res = await fetch('/api/wallet/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Revocation failed');
      setStatus('✅ Session revoked. Token is no longer valid.');
      setSessionToken('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Revocation failed';
      setError(msg);
      setStatus('');
    }
  }, [sessionToken]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#e0e0e0',
      fontFamily: 'system-ui, -apple-system, monospace',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        maxWidth: '480px',
        width: '100%',
        background: '#111',
        border: '1px solid #333',
        borderRadius: '12px',
        padding: '1.5rem',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}>
          <h1 style={{ fontSize: '16px', color: '#4a9eff', margin: 0 }}>
            Agentic Wallet
          </h1>
          {isConnected && (
            <button onClick={disconnect} style={{
              background: 'transparent',
              border: '1px solid #555',
              color: '#888',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              cursor: 'pointer',
            }}>
              Disconnect
            </button>
          )}
        </div>

        {/* Step indicator */}
        <div style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '1.5rem',
          justifyContent: 'center',
        }}>
          {(['connect', 'nonce', 'sign', 'done'] as const).map((s) => {
            const idx = ['connect', 'nonce', 'sign', 'done'].indexOf(s);
            const curIdx = ['connect', 'nonce', 'sign', 'done'].indexOf(step);
            const active = idx <= curIdx && step !== 'error';
            return (
              <div key={s} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: active ? 1 : 0.3,
                color: active ? '#4a9eff' : '#666',
                fontSize: '11px',
              }}>
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: active ? '#4a9eff' : '#1a1a1a',
                  border: '1px solid ' + (active ? '#4a9eff' : '#444'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: active ? '#0a0a0a' : '#666',
                }}>
                  {idx + 1}
                </div>
                <span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                {idx < 3 && <span style={{ color: '#444' }}>→</span>}
              </div>
            );
          })}
        </div>

        {/* Connect state */}
        {!isConnected ? (
          <button onClick={connect} style={{
            width: '100%',
            padding: '14px',
            fontSize: '14px',
            background: '#4a9eff',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
          }}>
            Connect Wallet
          </button>
        ) : (
          <>
            {/* Wallet info */}
            <div style={{
              background: '#1a1a1a',
              border: '1px solid ' + (chainOk ? '#333' : 'rgba(255,80,80,0.3)'),
              borderRadius: '8px',
              padding: '0.75rem',
              marginBottom: '1rem',
              fontSize: '12px',
              wordBreak: 'break-all',
            }}>
              <div style={{ color: '#888', marginBottom: '4px' }}>
                WALLET <span style={{ color: '#4a9eff' }}>● Base</span>
              </div>
              <div style={{ color: '#ccc', fontFamily: 'monospace', fontSize: '11px' }}>
                {address}
              </div>
              <div style={{
                color: balanceRaw > 0n ? '#4ade80' : '#f59e0b',
                marginTop: '4px',
              }}>
                USDC Balance: <strong>{balance}</strong>
                {balanceRaw === 0n && balance !== '...' && balance !== 'ERROR' && (
                  <span style={{ color: '#f59e0b', marginLeft: '8px', fontSize: '10px' }}>
                    ⚠️ Zero — you need USDC on Base to authorize
                  </span>
                )}
              </div>
              {!chainOk && (
                <div style={{ color: '#ef4444', marginTop: '4px', fontSize: '10px' }}>
                  ⚠️ Wrong network — must be Base Mainnet
                </div>
              )}
            </div>

            {/* Allowance input */}
            {step !== 'done' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ color: '#aaa', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                  Allowance (USDC)
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={allowanceUSD}
                    onChange={(e) => setAllowanceUSD(e.target.value)}
                    min="0.01"
                    max="100"
                    step="1"
                    style={{
                      flex: 1,
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      color: '#e0e0e0',
                      borderRadius: '6px',
                      padding: '8px',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                    disabled={step === 'nonce' || step === 'sign' || step === 'submit'}
                  />
                  <span style={{ color: '#888', fontSize: '12px' }}>USDC</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {[5, 10, 25, 50].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAllowanceUSD(String(v))}
                      disabled={step === 'nonce' || step === 'sign' || step === 'submit'}
                      style={{
                        background: allowanceUSD === String(v) ? '#4a9eff33' : 'transparent',
                        border: '1px solid ' + (allowanceUSD === String(v) ? '#4a9eff' : '#444'),
                        color: allowanceUSD === String(v) ? '#4a9eff' : '#888',
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >${v}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Security warning */}
            {step === 'nonce' && (
              <div style={{
                padding: '0.5rem',
                background: '#f59e0b22',
                border: '1px solid #f59e0b44',
                borderRadius: '4px',
                marginBottom: '1rem',
                fontSize: '11px',
                color: '#f59e0b',
                lineHeight: 1.5,
              }}>
                ⚠️ You are about to sign a <strong>Permit (EIP-2612)</strong> allowing
                the treasury to spend up to <strong>${allowanceUSD} USDC</strong> from your wallet.
                This is a gasless approval — no transaction fee now.
                Only sign if you trust this service with this amount.
              </div>
            )}

            {/* Authorize button */}
            {step === 'nonce' && (
              <button
                onClick={authorize}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '14px',
                  background: '#4a9eff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  opacity: balanceRaw === 0n ? 0.5 : 1,
                }}
                disabled={balanceRaw === 0n}
              >
                {balanceRaw === 0n ? 'Deposit USDC First' : 'Sign Permit & Authorize'}
              </button>
            )}

            {/* Signing / Submitting progress */}
            {(step === 'sign' || step === 'submit') && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>
                  {step === 'sign' ? '✍️' : '⏳'}
                </div>
                <div style={{ color: '#aaa', fontSize: '12px', whiteSpace: 'pre-line' }}>
                  {status}
                </div>
              </div>
            )}

            {/* Status messages */}
            {status && step !== 'sign' && step !== 'submit' && step !== 'error' && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#1a1a1a',
                borderRadius: '8px',
                fontSize: '12px',
                color: status.includes('✅') ? '#4ade80' : '#aaa',
              }}>
                {status}
              </div>
            )}

            {/* Session token (done) */}
            {sessionToken && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: '#1a1a1a',
                border: '1px solid #4ade8044',
                borderRadius: '8px',
              }}>
                <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>
                  ✅ Authorized — ${allowanceUSD} USDC budget ready
                </div>
                <div style={{ color: '#888', fontSize: '10px', marginBottom: '4px' }}>
                  SESSION TOKEN — set this in your agent MCP config
                </div>
                <div
                  onClick={copyToken}
                  style={{
                    fontSize: '12px',
                    color: '#4ade80',
                    wordBreak: 'break-all',
                    cursor: 'pointer',
                    padding: '8px 10px',
                    background: '#0a0a0a',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    border: '1px solid #4ade8022',
                    userSelect: 'all',
                  }}
                  title="Click to copy"
                >
                  {sessionToken}
                </div>

                <details style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
                  <summary style={{ cursor: 'pointer', color: '#aaa' }}>MCP config example</summary>
                  <pre style={{
                    background: '#0a0a0a',
                    padding: '8px',
                    borderRadius: '6px',
                    marginTop: '4px',
                    fontSize: '10px',
                    overflowX: 'auto',
                    color: '#aaa',
                  }}>
{`{
  "mcpServers": {
    "your-server": {
      "url": "https://your-domain.com/api/mcp",
      "headers": {
        "Session-Token": "${sessionToken}"
      }
    }
  }
}`}
                  </pre>
                </details>

                {/* Revoke button */}
                <button
                  onClick={revoke}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: '12px',
                    background: 'transparent',
                    border: '1px solid #f59e0b44',
                    color: '#f59e0b',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  ⚠ Revoke Session
                </button>
              </div>
            )}

            {/* Permit tx link */}
            {permitTx && (
              <div style={{ marginTop: '0.5rem', fontSize: '10px', color: '#888' }}>
                Permit tx: <a
                  href={`https://basescan.org/tx/${permitTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#4a9eff' }}
                >{permitTx.slice(0, 16)}...↗</a>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#ef444422',
                border: '1px solid #ef444444',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#ef4444',
              }}>
                ❌ {error}
                <button
                  onClick={() => { setError(''); setStep('nonce'); }}
                  style={{
                    display: 'block',
                    marginTop: '8px',
                    background: 'transparent',
                    border: '1px solid #ef4444',
                    color: '#ef4444',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Footer */}
            {step !== 'done' && step !== 'sign' && step !== 'submit' && !error && (
              <div style={{
                marginTop: '1rem',
                fontSize: '11px',
                color: '#666',
                textAlign: 'center',
                lineHeight: 1.5,
              }}>
                Sign a one-time <strong>Permit (EIP-2612)</strong> giving the treasury
                allowance to spend USDC on your behalf. No recurring charges — the permit
                defines a maximum budget and 30-day expiry. Revoke anytime.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
