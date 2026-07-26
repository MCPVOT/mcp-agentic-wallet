'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * Generic Agentic Wallet UI
 *
 * A reference wallet connection page that:
 *   1. Connects to MetaMask / Coinbase Wallet / Brave Wallet
 *   2. Switches to Base Mainnet
 *   3. Signs an EIP-2612 Permit (gasless, 1-time)
 *   4. Submits to the server's /api/wallet/authorize
 *   5. Returns a session token for MCP agent config
 *
 * No branding — fork this for your own project.
 * Responsive: mobile-first, adapts to all screen sizes.
 */

const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = '0x2105';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

// Treasury address — configure via env or hardcode for your deployment
const TREASURY = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  '0x00000000000000000000000000000000000000') as `0x${string}`;

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

// ── Helpers ──────────────────────────────────────────────────
function shortAddr(a: string) {
  if (!a) return '';
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatUSDC(raw: bigint) {
  const str = raw.toString();
  const int = str.length > 6 ? str.slice(0, -6) : '0';
  const dec = str.length > 6 ? str.slice(-6).padStart(6, '0').replace(/0+$/, '') : str.padStart(6, '0').replace(/0+$/, '');
  if (dec === '') return int || '0';
  return `${int}.${dec}`;
}

// ── Responsive hook ─────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

export default function WalletPage() {
  const isMobile = useIsMobile();

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
  const [busy, setBusy] = useState(false);
  const [showPill, setShowPill] = useState(false);

  // ── Check if wallet is already connected ──────────────────
  useEffect(() => {
    const checkExisting = async () => {
      if (!window.ethereum) return;
      try {
        const accounts: string[] = await window.ethereum.request({
          method: 'eth_accounts',
        });
        if (accounts && accounts[0]) {
          const chainId: string = await window.ethereum.request({ method: 'eth_chainId' });
          if (parseInt(chainId, 16) === BASE_CHAIN_ID) {
            setAddress(accounts[0].toLowerCase());
            setIsConnected(true);
            setChainOk(true);
            setStep('nonce');
            fetchBalance(accounts[0].toLowerCase());
          }
        }
      } catch { /* ignore */ }
    };
    if (typeof window !== 'undefined') checkExisting();
  }, []);

  // ── Detect Brave Wallet ───────────────────────────────────
  const isBrave = typeof window !== 'undefined' &&
    navigator.userAgent.includes('Brave') &&
    typeof (window as { braveWallet?: unknown }).braveWallet !== 'undefined';

  const browserName = isBrave ? 'Brave' :
    typeof window !== 'undefined' && window.ethereum?.isCoinbaseWallet ? 'Coinbase' :
    typeof window !== 'undefined' && window.ethereum?.isMetaMask ? 'MetaMask' :
    'Unknown Wallet';

  // ── Connect wallet ────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('No wallet detected. Install MetaMask, Coinbase Wallet, or use Brave (built-in).');
      return;
    }
    setBusy(true);
    setError('');
    setStep('connect');

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
    } finally {
      setBusy(false);
    }
  }, []);

  const fetchBalance = useCallback(async (owner: string) => {
    try {
      const data = BALANCE_OF_SEL + owner.slice(2).padStart(64, '0');
      const result = await rpcCall('eth_call', [{ to: USDC_BASE, data }, 'latest']);
      const bal = BigInt(result || '0x0');
      setBalanceRaw(bal);
      setBalance(formatUSDC(bal));
    } catch {
      setBalance('ERROR');
    }
  }, []);

  // ── Sign EIP-2612 Permit ──────────────────────────────────
  const authorize = useCallback(async () => {
    if (!address || !window.ethereum || !chainOk || busy) return;
    setBusy(true);
    setError('');
    setSessionToken('');

    const usdAmount = parseFloat(allowanceUSD);
    if (isNaN(usdAmount) || usdAmount < 0.01) {
      setError('Minimum allowance is $0.01 USDC.');
      setBusy(false);
      return;
    }

    if (balanceRaw < BigInt(Math.floor(usdAmount * 1_000_000))) {
      setError(`Insufficient USDC balance. You have ${balance}, need at least $${allowanceUSD}.`);
      setBusy(false);
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
      setStatus('Review the permit in your wallet — this is a gasless signature.');

      const message = {
        owner,
        spender: TREASURY,
        value: allowanceAtomic.toString(),
        nonce: nonce.toString(),
        deadline,
      };

      // Support both Brave and MetaMask
      const signMethod = window.ethereum.isBraveWallet ? 'eth_signTypedData' : 'eth_signTypedData_v4';
      const signature: string = await window.ethereum.request({
        method: signMethod,
        params: signMethod === 'eth_signTypedData'
          ? [owner, JSON.stringify(message)]
          : [owner, JSON.stringify({ domain: PERMIT_DOMAIN, types: PERMIT_TYPES, primaryType: 'Permit', message })],
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
    } finally {
      setBusy(false);
    }
  }, [address, allowanceUSD, balanceRaw, balance, chainOk, busy]);

  const copyToken = () => {
    if (sessionToken) {
      navigator.clipboard.writeText(sessionToken).catch(() => {});
      setShowPill(true);
      setTimeout(() => setShowPill(false), 2000);
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
    setBusy(false);
  };

  const revoke = useCallback(async () => {
    if (!sessionToken) return;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }, [sessionToken]);

  // ── Responsive styles ──────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#e0e0e0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isMobile ? '0.5rem' : '1rem',
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: isMobile ? '100%' : '480px',
    width: '100%',
    background: '#111',
    border: '1px solid #2a2a3a',
    borderRadius: '12px',
    padding: isMobile ? '1rem' : '1.5rem',
    boxShadow: '0 0 40px rgba(0,230,0,0.03)',
  };

  const btnPrimaryStyle: React.CSSProperties = {
    width: '100%',
    padding: isMobile ? '16px' : '14px',
    fontSize: isMobile ? '16px' : '14px',
    background: 'linear-gradient(135deg, #00e5ff, #00a5cc)',
    color: '#000',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 700,
    letterSpacing: '0.3px',
    transition: 'opacity 0.2s',
    opacity: busy ? 0.6 : 1,
  };

  const btnSecondaryStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid #4a9eff44',
    color: '#4a9eff',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    color: '#aaa',
    fontSize: isMobile ? '11px' : '12px',
    display: 'block',
    marginBottom: '4px',
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#e0e0e0',
    borderRadius: '6px',
    padding: isMobile ? '12px' : '8px',
    fontSize: isMobile ? '16px' : '14px',
    fontFamily: 'monospace',
    outline: 'none',
    minWidth: 0,
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <main style={containerStyle}>
      {/* Logo + title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '1.5rem',
      }}>
        <img
          src="/logo.svg"
          alt=""
          style={{ width: isMobile ? '28px' : '32px', height: 'auto' }}
        />
        <h1 style={{
          fontSize: isMobile ? '18px' : '16px',
          color: '#00e5ff',
          margin: 0,
          fontWeight: 700,
          letterSpacing: '-0.3px',
        }}>
          Agentic Wallet
        </h1>
        <span style={{
          fontSize: '10px',
          color: '#555',
          marginLeft: 'auto',
          fontFamily: 'monospace',
        }}>
          {browserName}
        </span>
      </div>

      <div style={cardStyle}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}>
          {isConnected && (
            <button onClick={disconnect} style={{
              ...btnSecondaryStyle,
              fontSize: '11px',
              padding: '4px 8px',
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
          flexWrap: 'wrap',
        }}>
          {(['connect', 'nonce', 'sign', 'done'] as const).map((s) => {
            const curIdx = ['connect', 'nonce', 'sign', 'done'].indexOf(step);
            const idx = ['connect', 'nonce', 'sign', 'done'].indexOf(s);
            const active = idx <= curIdx && step !== 'error';
            return (
              <div key={s} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: active ? 1 : 0.3,
                color: active ? '#00e5ff' : '#555',
                fontSize: '11px',
              }}>
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: active ? '#00e5ff' : '#1a1a1a',
                  border: '1px solid ' + (active ? '#00e5ff' : '#333'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: active ? '#000' : '#555',
                  fontWeight: 700,
                }}>
                  {idx + 1}
                </div>
                {!isMobile && <span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>}
                {idx < 3 && <span style={{ color: '#333', fontSize: '10px' }}>→</span>}
              </div>
            );
          })}
        </div>

        {/* Connect state */}
        {!isConnected ? (
          <button onClick={connect} style={btnPrimaryStyle} disabled={busy}>
            {busy ? 'Connecting...' : '🔗 Connect Wallet'}
          </button>
        ) : (
          <>
            {/* Wallet info card */}
            <div style={{
              background: '#1a1a1a',
              border: '1px solid ' + (chainOk ? '#2a2a3a' : 'rgba(255,80,80,0.3)'),
              borderRadius: '8px',
              padding: isMobile ? '0.5rem' : '0.75rem',
              marginBottom: '1rem',
              fontSize: '12px',
              wordBreak: 'break-all',
            }}>
              <div style={{ color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>WALLET <span style={{ color: '#00e5ff' }}>● Base</span></span>
                {!chainOk && <span style={{ color: '#ef4444', fontSize: '10px' }}>⚠ Wrong network</span>}
              </div>
              <div style={{
                color: '#ccc',
                fontFamily: 'monospace',
                fontSize: isMobile ? '11px' : '11px',
                background: '#0a0a0a',
                padding: '4px 8px',
                borderRadius: '4px',
                marginBottom: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}>
                <span>{isMobile ? shortAddr(address) : address}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(address)}
                  style={{ background: 'none', border: 'none', color: '#00e5ff', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
                  title="Copy address"
                >📋</button>
              </div>
              <div style={{
                color: balanceRaw > 0n ? '#4ade80' : '#f59e0b',
                marginTop: '4px',
                fontSize: '13px',
              }}>
                Balance: <strong>{balance}</strong> USDC
              </div>
              {balanceRaw === 0n && balance !== '...' && balance !== 'ERROR' && (
                <div style={{ color: '#f59e0b', marginTop: '4px', fontSize: '10px' }}>
                  ⚠️ Zero — you need USDC on Base to authorize
                </div>
              )}
            </div>

            {/* Allowance input */}
            {step !== 'done' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Allowance (USDC)</label>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}>
                  <input
                    type="number"
                    value={allowanceUSD}
                    onChange={(e) => setAllowanceUSD(e.target.value)}
                    min="0.01"
                    max="100"
                    step="1"
                    style={inputStyle}
                    disabled={step === 'nonce' || step === 'sign' || step === 'submit'}
                  />
                  <span style={{ color: '#666', fontSize: '12px', fontWeight: 600 }}>USDC</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {[5, 10, 25, 50].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAllowanceUSD(String(v))}
                      disabled={step === 'nonce' || step === 'sign' || step === 'submit'}
                      style={{
                        background: allowanceUSD === String(v) ? '#00e5ff22' : 'transparent',
                        border: '1px solid ' + (allowanceUSD === String(v) ? '#00e5ff' : '#333'),
                        color: allowanceUSD === String(v) ? '#00e5ff' : '#666',
                        borderRadius: '4px',
                        padding: isMobile ? '6px 10px' : '3px 8px',
                        fontSize: isMobile ? '12px' : '11px',
                        cursor: 'pointer',
                        fontWeight: allowanceUSD === String(v) ? 600 : 400,
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
                background: '#f59e0b11',
                border: '1px solid #f59e0b33',
                borderRadius: '6px',
                marginBottom: '1rem',
                fontSize: '11px',
                color: '#f59e0b',
                lineHeight: 1.5,
              }}>
                ⚠️ You are about to sign a <strong>Permit (EIP-2612)</strong> allowing
                the treasury to spend up to <strong>${allowanceUSD} USDC</strong> from your wallet.
                This is a gasless approval — no transaction fee now.
                Only sign if you trust this service.
              </div>
            )}

            {/* Authorize button */}
            {step === 'nonce' && (
              <button
                onClick={authorize}
                style={btnPrimaryStyle}
                disabled={balanceRaw === 0n || busy}
              >
                {busy ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                    {step === 'nonce' ? 'Reading nonce...' : step === 'sign' ? 'Waiting for signature...' : 'Submitting...'}
                  </span>
                ) : (
                  '✅ Sign Permit & Authorize'
                )}
              </button>
            )}

            {/* Signing / Submitting progress */}
            {(step === 'sign' || step === 'submit') && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>
                  {step === 'sign' ? '✍️' : '⏳'}
                </div>
                <div style={{ color: '#888', fontSize: '12px', whiteSpace: 'pre-line' }}>
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
                border: '1px solid #4ade8022',
                borderRadius: '8px',
              }}>
                <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>
                  ✅ Authorized — ${allowanceUSD} USDC budget ready
                </div>
                <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>
                  SESSION TOKEN — set this in your agent MCP config
                </div>
                <div
                  onClick={copyToken}
                  style={{
                    fontSize: '12px',
                    color: '#4ade80',
                    wordBreak: 'break-all',
                    cursor: 'pointer',
                    padding: isMobile ? '12px' : '8px 10px',
                    background: '#0a0a0a',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    border: '1px solid #4ade8022',
                    userSelect: 'all',
                    position: 'relative',
                  }}
                  title="Click to copy"
                >
                  {sessionToken}
                  {showPill && (
                    <span style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#4ade80',
                      color: '#000',
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}>✓ Copied</span>
                  )}
                </div>

                <details style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>MCP config example</summary>
                  <pre style={{
                    background: '#0a0a0a',
                    padding: '8px',
                    borderRadius: '6px',
                    marginTop: '4px',
                    fontSize: '10px',
                    overflowX: 'auto',
                    color: '#888',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
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
                    padding: isMobile ? '10px' : '8px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  disabled={busy}
                >
                  ⚠ Revoke Session
                </button>
              </div>
            )}

            {/* Permit tx link */}
            {permitTx && (
              <div style={{ marginTop: '0.5rem', fontSize: '10px', color: '#555' }}>
                Permit tx: <a
                  href={`https://basescan.org/tx/${permitTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#00e5ff' }}
                >{permitTx.slice(0, 16)}...↗</a>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#ef444411',
                border: '1px solid #ef444433',
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
                    padding: isMobile ? '8px 16px' : '4px 12px',
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
                color: '#444',
                textAlign: 'center',
                lineHeight: 1.5,
              }}>
                Sign a one-time <strong>Permit (EIP-2612)</strong> giving the treasury
                allowance to spend USDC on your behalf. No recurring charges — the permit
                defines a max budget and 30-day expiry. Revoke anytime.
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer style={{
        marginTop: '1.5rem',
        fontSize: '10px',
        color: '#333',
        textAlign: 'center',
      }}>
        Powered by EIP-2612 Permit · USDC on Base · No keys, no recurring fees
      </footer>

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 480px) {
          button { font-size: 16px !important; padding: 16px !important; }
          input { font-size: 16px !important; }
        }
      `}</style>
    </main>
  );
}