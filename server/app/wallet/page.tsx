'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * Generic Agentic Wallet UI
 *
 * Connect to any EIP-1193 wallet (MetaMask, Coinbase, Brave, Binance, Trust,
 * WalletConnect, Rainbow, etc.) → sign EIP-2612 Permit → get session token.
 * Works on all screen sizes and in Brave Browser.
 */

const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = '0x2105';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

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

function formatUSDC(raw: bigint): string {
  const str = raw.toString();
  if (raw === 0n) return '0';
  const int = str.length > 6 ? str.slice(0, -6) : '0';
  const dec = str.length > 6 ? str.slice(-6).padStart(6, '0').replace(/0+$/, '') : '';
  return dec ? `${int}.${dec}` : int;
}

function shortAddr(a: string): string {
  if (!a) return '';
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

// ── Wallet Detection (EIP-6963 + legacy injected providers) ────
// Supports: MetaMask, Coinbase Wallet, Brave Wallet, Binance Chain Wallet,
// Trust Wallet, Rainbow, Rabby, WalletConnect, Phantom, Ledger, Tally, etc.
function detectWallet(): { name: string; provider: unknown; isBinance: boolean } {
  if (typeof window === 'undefined') return { name: 'Unknown', provider: null, isBinance: false };

  // EIP-6963: formal provider discovery (2024+) — multiple providers per page
  const eth = window.ethereum as { providers?: unknown[]; isMetaMask?: boolean; isCoinbaseWallet?: boolean; isBraveWallet?: boolean; isBinance?: boolean; isTrust?: boolean } | undefined;

  if (eth?.providers && Array.isArray(eth.providers)) {
    for (const p of eth.providers) {
      const w = p as { isMetaMask?: boolean; isCoinbaseWallet?: boolean; isBraveWallet?: boolean; isBinance?: boolean };
      if (w.isBinance) return { name: 'Binance Chain Wallet', provider: p, isBinance: true };
      if (w.isMetaMask) return { name: 'MetaMask', provider: p, isBinance: false };
      if (w.isCoinbaseWallet) return { name: 'Coinbase Wallet', provider: p, isBinance: false };
      if (w.isBraveWallet) return { name: 'Brave Wallet', provider: p, isBinance: false };
    }
  }

  // Legacy single injected provider
  if (eth) {
    if (eth.isBinance) return { name: 'Binance Chain Wallet', provider: eth, isBinance: true };
    if (eth.isMetaMask) return { name: 'MetaMask', provider: eth, isBinance: false };
    if (eth.isCoinbaseWallet) return { name: 'Coinbase Wallet', provider: eth, isBinance: false };
    if (eth.isBraveWallet) return { name: 'Brave Wallet', provider: eth, isBinance: false };
    if (eth.isTrust) return { name: 'Trust Wallet', provider: eth, isBinance: false };
    return { name: 'Web3 Wallet', provider: eth, isBinance: false };
  }

  return { name: 'No Wallet', provider: null, isBinance: false };
}

export default function WalletPage() {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 640 : false;

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
  const [copied, setCopied] = useState(false);
  const [walletName] = useState<string>(() => detectWallet().name);
  const [isBinance] = useState<boolean>(() => detectWallet().isBinance);

  // ── Check existing connection on mount ──────────────────
  useEffect(() => {
    const checkExisting = async () => {
      if (!window.ethereum) return;
      try {
        const accounts: string[] = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts?.[0]) {
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
    checkExisting();

    // Listen for account/chain changes
    const onAccounts = (accounts: string[]) => {
      if (!accounts?.[0]) { disconnect(); }
    };
    const onChain = (chainId: string) => {
      if (parseInt(chainId, 16) !== BASE_CHAIN_ID) { setChainOk(false); }
    };
    window.ethereum?.on?.('accountsChanged', onAccounts);
    window.ethereum?.on?.('chainChanged', onChain);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts);
      window.ethereum?.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const fetchBalance = useCallback(async (owner: string) => {
    try {
      const data = BALANCE_OF_SEL + owner.slice(2).padStart(64, '0');
      const result = await rpcCall('eth_call', [{ to: USDC_BASE, data }, 'latest']);
      const bal = BigInt(result || '0x0');
      setBalanceRaw(bal);
      setBalance(formatUSDC(bal));
    } catch { setBalance('ERROR'); }
  }, []);

  // ── Connect wallet ──────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('No wallet detected. Install MetaMask, Coinbase Wallet, Binance Chain Wallet, Brave, or Trust Wallet.');
      return;
    }
    setBusy(true);
    setError('');
    setStep('connect');

    try {
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new Error('No accounts returned');

      // Binance wallet needs addEthereumChain before switch
      if (isBinance) {
        try {
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
        } catch { /* chain may already be added */ }
      }

      // Switch to Base
      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID_HEX }] });
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number }).code;
        if (code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_CHAIN_ID_HEX, chainName: 'Base Mainnet',
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
      if (parseInt(chainId, 16) !== BASE_CHAIN_ID) throw new Error('Wrong network. Expected Base Mainnet.');

      setAddress(accounts[0].toLowerCase());
      setIsConnected(true);
      setChainOk(true);
      setStep('nonce');

      // Binance wallet needs a brief delay after addEthereumChain
      if (isBinance) await new Promise(r => setTimeout(r, 500));
      fetchBalance(accounts[0].toLowerCase());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setStep('error');
    } finally {
      setBusy(false);
    }
  }, [isBinance, fetchBalance]);

  // ── Sign EIP-2612 Permit ────────────────────────────────
  const authorize = useCallback(async () => {
    if (!address || !window.ethereum || !chainOk || busy) return;
    setBusy(true);
    setError('');
    setSessionToken('');

    const usdAmount = parseFloat(allowanceUSD);
    if (isNaN(usdAmount) || usdAmount < 0.01) { setError('Minimum allowance is $0.01 USDC.'); setBusy(false); return; }
    if (balanceRaw < BigInt(Math.floor(usdAmount * 1_000_000))) {
      setError(`Insufficient USDC balance. You have ${balance}, need at least $${allowanceUSD}.`);
      setBusy(false); return;
    }

    try {
      const owner = address as `0x${string}`;
      const deadline = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const allowanceAtomic = BigInt(Math.floor(usdAmount * 1_000_000));

      // Read nonce
      setStep('nonce');
      setStatus('Reading permit nonce from USDC contract...');
      const nonceData = NONCES_SEL + owner.slice(2).padStart(64, '0');
      const nonceRaw = await rpcCall('eth_call', [{ to: USDC_BASE, data: nonceData }, 'latest']);
      const nonce = BigInt(nonceRaw || '0x0');
      setStatus(`Nonce: ${nonce.toString()}`);

      // Sign
      setStep('sign');
      setStatus('Review the permit in your wallet — this is a gasless signature.');

      const message = { owner, spender: TREASURY, value: allowanceAtomic.toString(), nonce: nonce.toString(), deadline };

      const signMethod = isBinance ? 'eth_signTypedData_v4' : 'eth_signTypedData_v4';
      const signature: string = await window.ethereum.request({
        method: signMethod,
        params: [owner, JSON.stringify({ domain: PERMIT_DOMAIN, types: PERMIT_TYPES, primaryType: 'Permit', message })],
      });

      const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
      const r = '0x' + sig.slice(0, 64);
      const s = '0x' + sig.slice(64, 128);
      const v = parseInt(sig.slice(128, 130), 16);

      // Submit to server
      setStep('submit');
      setStatus('Submitting authorization to server...');
      const res = await fetch('/api/wallet/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ humanAddress: address, allowance: allowanceAtomic.toString(), deadline, v, r, s, label: 'wallet-ui' }),
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
      setError(e instanceof Error ? e.message : 'Authorization failed');
      setStep('error');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }, [address, allowanceUSD, balanceRaw, balance, chainOk, busy, isBinance]);

  const copyToken = useCallback(() => {
    if (sessionToken) {
      navigator.clipboard.writeText(sessionToken).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setStatus('📋 Token copied!');
    }
  }, [sessionToken]);

  const disconnect = useCallback(() => {
    setAddress(''); setBalance('...'); setBalanceRaw(0n);
    setIsConnected(false); setChainOk(false); setSessionToken('');
    setPermitTx(''); setStatus(''); setError(''); setStep('connect'); setBusy(false);
  }, []);

  const revoke = useCallback(async () => {
    if (!sessionToken) return;
    setBusy(true); setError(''); setStatus('Revoking session...');
    try {
      const res = await fetch('/api/wallet/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Revocation failed');
      setStatus('✅ Session revoked.'); setSessionToken('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Revocation failed'); setStatus('');
    } finally { setBusy(false); }
  }, [sessionToken]);

  // ── Styles (responsive, mobile-first) ────────────────────
  const container: React.CSSProperties = {
    minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? '0.75rem' : '1.5rem',
  };
  const card: React.CSSProperties = {
    maxWidth: isMobile ? '100%' : '480px', width: '100%',
    background: '#111', border: '1px solid #2a2a3a', borderRadius: '12px',
    padding: isMobile ? '1rem' : '1.5rem', boxShadow: '0 0 40px rgba(0,230,0,0.03)',
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: isMobile ? '16px' : '14px',
    fontSize: isMobile ? '16px' : '14px', fontWeight: 700,
    background: 'linear-gradient(135deg, #00e5ff, #00a5cc)', color: '#000',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    letterSpacing: '0.3px', opacity: busy ? 0.6 : 1,
  };
  const btnSecondary: React.CSSProperties = {
    background: 'transparent', border: '1px solid #4a9eff44', color: '#4a9eff',
    borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
  };
  const label: React.CSSProperties = { color: '#aaa', fontSize: '12px', display: 'block', marginBottom: '4px' };
  const input: React.CSSProperties = {
    flex: 1, background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0',
    borderRadius: '6px', padding: isMobile ? '12px' : '8px',
    fontSize: isMobile ? '16px' : '14px', fontFamily: 'monospace', outline: 'none', minWidth: 0,
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <main style={container}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
        <img src="/logo.svg" alt="Wallet" style={{ width: isMobile ? '28px' : '32px', height: 'auto' }} />
        <h1 style={{ fontSize: isMobile ? '18px' : '16px', color: '#00e5ff', margin: 0, fontWeight: 700 }}>
          Agentic Wallet
        </h1>
        <span style={{ fontSize: '10px', color: '#555', marginLeft: 'auto', fontFamily: 'monospace' }}>
          {walletName}
        </span>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          {isConnected && (
            <button onClick={disconnect} style={btnSecondary}>Disconnect</button>
          )}
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {(['connect', 'nonce', 'sign', 'done'] as const).map((s) => {
            const active = ['connect', 'nonce', 'sign', 'done'].indexOf(s) <= ['connect', 'nonce', 'sign', 'done'].indexOf(step) && step !== 'error';
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: active ? 1 : 0.3, color: active ? '#00e5ff' : '#555', fontSize: '11px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: active ? '#00e5ff' : '#1a1a1a', border: '1px solid ' + (active ? '#00e5ff' : '#333'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: active ? '#000' : '#555', fontWeight: 700 }}>{['connect', 'nonce', 'sign', 'done'].indexOf(s) + 1}</div>
                {!isMobile && <span>{s.charAt(0).toUpperCase() + s.slice(1)}</span>}
                {['connect', 'nonce', 'sign', 'done'].indexOf(s) < 3 && <span style={{ color: '#333', fontSize: '10px' }}>→</span>}
              </div>
            );
          })}
        </div>

        {/* Connect */}
        {!isConnected ? (
          <button onClick={connect} style={btnPrimary} disabled={busy}>
            {busy ? '⏳ Connecting...' : '🔗 Connect Wallet'}
          </button>
        ) : (
          <>
            {/* Wallet info */}
            <div style={{ background: '#1a1a1a', border: '1px solid ' + (chainOk ? '#2a2a3a' : 'rgba(255,80,80,0.3)'), borderRadius: '8px', padding: isMobile ? '0.75rem' : '1rem', marginBottom: '1rem', fontSize: '13px', wordBreak: 'break-all' }}>
              <div style={{ color: '#666', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>WALLET <span style={{ color: '#00e5ff' }}>● Base</span></span>
                {!chainOk && <span style={{ color: '#ef4444', fontSize: '10px' }}>⚠ Wrong network</span>}
              </div>
              <div style={{ color: '#ccc', fontFamily: 'monospace', fontSize: '11px', background: '#0a0a0a', padding: '4px 8px', borderRadius: '4px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span>{isMobile ? shortAddr(address) : address}</span>
                <button onClick={() => navigator.clipboard.writeText(address)} style={{ background: 'none', border: 'none', color: '#00e5ff', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }} title="Copy">📋</button>
              </div>
              <div style={{ color: balanceRaw > 0n ? '#4ade80' : '#f59e0b', marginTop: '4px', fontSize: '13px' }}>
                Balance: <strong>{balance}</strong> USDC
              </div>
              {balanceRaw === 0n && balance !== '...' && balance !== 'ERROR' && (
                <div style={{ color: '#f59e0b', marginTop: '4px', fontSize: '10px' }}>⚠️ Zero — deposit USDC on Base first</div>
              )}
            </div>

            {/* Allowance */}
            {step !== 'done' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={label}>Allowance (USDC)</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="number" value={allowanceUSD} onChange={(e) => setAllowanceUSD(e.target.value)} min="0.01" max="100" step="1" style={input} disabled={step === 'nonce' || step === 'sign' || step === 'submit'} />
                  <span style={{ color: '#666', fontSize: '12px', fontWeight: 600 }}>USDC</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {[5, 10, 25, 50].map((v) => (
                    <button key={v} onClick={() => setAllowanceUSD(String(v))} disabled={step === 'nonce' || step === 'sign' || step === 'submit'} style={{
                      background: allowanceUSD === String(v) ? '#00e5ff22' : 'transparent',
                      border: '1px solid ' + (allowanceUSD === String(v) ? '#00e5ff' : '#333'),
                      color: allowanceUSD === String(v) ? '#00e5ff' : '#666',
                      borderRadius: '4px', padding: isMobile ? '6px 10px' : '3px 8px',
                      fontSize: isMobile ? '12px' : '11px', cursor: 'pointer',
                      fontWeight: allowanceUSD === String(v) ? 600 : 400,
                    }}>${v}</button>
                  ))}
                </div>
              </div>
            )}

            {step === 'nonce' && (
              <div style={{ padding: '0.5rem', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: '6px', marginBottom: '1rem', fontSize: '11px', color: '#f59e0b', lineHeight: 1.5 }}>
                ⚠️ Sign a <strong>Permit (EIP-2612)</strong> allowing the treasury to spend <strong>${allowanceUSD} USDC</strong>. Gasless — no transaction fee now.
              </div>
            )}

            {step === 'nonce' && (
              <button onClick={authorize} style={btnPrimary} disabled={balanceRaw === 0n || busy}>
                {busy ? <span>⏳ Submitting...</span> : '✅ Sign Permit & Authorize'}
              </button>
            )}

            {(step === 'sign' || step === 'submit') && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <div style={{ fontSize: '32px', marginBottom: '0.5rem' }}>{step === 'sign' ? '✍️' : '⏳'}</div>
                <div style={{ color: '#888', fontSize: '12px', whiteSpace: 'pre-line' }}>{status}</div>
              </div>
            )}

            {status && step !== 'sign' && step !== 'submit' && step !== 'error' && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1a1a1a', borderRadius: '8px', fontSize: '12px', color: status.includes('✅') ? '#4ade80' : '#aaa' }}>{status}</div>
            )}

            {sessionToken && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: '#1a1a1a', border: '1px solid #4ade8022', borderRadius: '8px' }}>
                <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>✅ Authorized — ${allowanceUSD} USDC budget ready</div>
                <div style={{ color: '#666', fontSize: '10px', marginBottom: '4px' }}>SESSION TOKEN — set in your agent MCP config</div>
                <div onClick={copyToken} style={{ fontSize: '12px', color: '#4ade80', wordBreak: 'break-all', cursor: 'pointer', padding: isMobile ? '12px' : '8px 10px', background: '#0a0a0a', borderRadius: '6px', fontFamily: 'monospace', border: '1px solid #4ade8022', userSelect: 'all', position: 'relative' }} title="Click to copy">
                  {sessionToken}
                  {copied && <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: '#4ade80', color: '#000', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>✓ Copied</span>}
                </div>
                <details style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>MCP config example</summary>
                  <pre style={{ background: '#0a0a0a', padding: '8px', borderRadius: '6px', marginTop: '4px', fontSize: '10px', overflowX: 'auto', color: '#888', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`{
  "mcpServers": {
    "your-server": {
      "url": "https://your-domain.com/api/mcp",
      "headers": { "Session-Token": "${sessionToken}" }
    }
  }
}`}
                  </pre>
                </details>
                <button onClick={revoke} style={{ display: 'block', width: '100%', marginTop: '12px', background: 'transparent', border: '1px solid #f59e0b44', color: '#f59e0b', borderRadius: '6px', padding: isMobile ? '10px' : '8px', fontSize: '12px', cursor: 'pointer' }} disabled={busy}>⚠ Revoke Session</button>
              </div>
            )}

            {permitTx && (
              <div style={{ marginTop: '0.5rem', fontSize: '10px', color: '#555' }}>
                Permit: <a href={`https://basescan.org/tx/${permitTx}`} target="_blank" rel="noopener noreferrer" style={{ color: '#00e5ff' }}>{permitTx.slice(0, 16)}...↗</a>
              </div>
            )}

            {error && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#ef444411', border: '1px solid #ef444433', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>
                ❌ {error}
                <button onClick={() => { setError(''); setStep('nonce'); }} style={{ display: 'block', marginTop: '8px', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Retry</button>
              </div>
            )}

            {step !== 'done' && step !== 'sign' && step !== 'submit' && !error && (
              <div style={{ marginTop: '1rem', fontSize: '11px', color: '#444', textAlign: 'center', lineHeight: 1.5 }}>
                Sign a one-time <strong>Permit (EIP-2612)</strong> — gasless, 30-day expiry, revocable anytime.
              </div>
            )}
          </>
        )}
      </div>

      <footer style={{ marginTop: '1.5rem', fontSize: '10px', color: '#333', textAlign: 'center' }}>
        EIP-2612 Permit · USDC on Base · No keys, no recurring fees
      </footer>

      {/* Prevent 300ms tap delay on mobile + larger touch targets */}
      <style>{`
        @media (max-width: 480px) {
          button { font-size: 16px !important; padding: 16px !important; min-height: 48px; }
          input { font-size: 16px !important; min-height: 44px; }
        }
        button { min-height: 44px; }
      `}</style>
    </main>
  );
}
