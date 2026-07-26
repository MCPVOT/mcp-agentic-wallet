/**
 * EIP-2612 Permit signature verification.
 *
 * Verifies that a human actually signed a Permit for the claimed
 * owner, spender, value, nonce, and deadline — using EIP-712
 * typed data verification via viem.
 */

import { createPublicClient, http, verifyTypedData, type Address } from 'viem';
import { base } from 'viem/chains';
import { PERMIT_DOMAIN, PERMIT_TYPES, USDC_ADDRESS, USDC_ABI } from './constants.js';

export interface VerifyPermitParams {
  /** Human's wallet address (lowercase) */
  owner: string;
  /** Treasury/spender address */
  spender: string;
  /** Allowance in atomic USDC units */
  value: bigint;
  /** Permit deadline (unix timestamp) */
  deadline: number;
  /** Signature v component */
  v: number;
  /** Signature r component */
  r: `0x${string}`;
  /** Signature s component */
  s: `0x${string}`;
  /** Optional RPC URL (defaults to mainnet.base.org) */
  rpcUrl?: string;
}

export interface VerifyPermitResult {
  valid: boolean;
  nonce?: bigint;
  error?: string;
}

/**
 * Verify an EIP-2612 Permit signature against on-chain state.
 *
 * This is the single most critical security check: it ensures the
 * human actually signed a permit for YOUR treasury as spender, with
 * the claimed allowance and deadline. Without this, anyone could
 * submit arbitrary v/r/s values and get a session token.
 *
 * Steps:
 * 1. Read the current nonce from the USDC contract (nonces(owner))
 * 2. Reconstruct the EIP-712 message with the on-chain nonce
 * 3. Call verifyTypedData to recover the signer
 * 4. If signer === owner, the signature is valid
 */
export async function verifyPermit(params: VerifyPermitParams): Promise<VerifyPermitResult> {
  const rpcUrl = params.rpcUrl || 'https://mainnet.base.org';
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  try {
    // Step 1: Read nonce from chain
    const nonceOnChain = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'nonces',
      args: [params.owner as `0x${string}`],
    });

    // Step 2: Reconstruct signature
    const signature =
      `0x${params.r.slice(2)}${params.s.slice(2)}${params.v.toString(16).padStart(2, '0')}` as `0x${string}`;

    // Step 3: Verify EIP-712 typed data
    let isValid = false;
    try {
      isValid = await verifyTypedData({
        address: params.owner as `0x${string}`,
        domain: PERMIT_DOMAIN,
        types: PERMIT_TYPES,
        primaryType: 'Permit',
        message: {
          owner: params.owner as `0x${string}`,
          spender: params.spender as `0x${string}`,
          value: params.value,
          nonce: nonceOnChain,
          deadline: BigInt(params.deadline),
        },
        signature,
      });
    } catch {
      return { valid: false, error: 'Invalid signature format' };
    }

    if (!isValid) {
      return { valid: false, nonce: nonceOnChain, error: 'Signature does not match permit data' };
    }

    return { valid: true, nonce: nonceOnChain };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Verification failed: ${msg}` };
  }
}

/**
 * Check on-chain allowance for an owner→spender pair.
 */
export async function checkAllowance(
  owner: string,
  spender: string,
  rpcUrl?: string,
): Promise<bigint> {
  const url = rpcUrl || 'https://mainnet.base.org';
  const publicClient = createPublicClient({
    chain: base,
    transport: http(url),
  });
  return publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
}
