/**
 * On-chain settlement — submits the human's signed permit and
 * executes transferFrom to settle each tool call.
 *
 * Flow:
 *   1. submitPermit(): calls permit() on USDC contract to set allowance (gas)
 *   2. settleCall(): calls transferFrom(human, treasury, amount) (gas)
 *
 * Requires a hot wallet with ETH for gas. The hot wallet is a
 * SINGLE-PURPOSE EOA — never use it for anything else.
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { USDC_ADDRESS, USDC_ABI } from './constants.js';
import type { SettlementResult } from './types.js';

export interface SettlementConfig {
  /** Treasury address (receives USDC) */
  treasuryAddress: string;
  /** Hot wallet private key (for gas) — env var recommended */
  hotWalletKey?: string;
  /** RPC URL (defaults to mainnet.base.org) */
  rpcUrl?: string;
}

const DEFAULT_RPC = 'https://mainnet.base.org';

function getWalletClient(config: SettlementConfig) {
  if (!config.hotWalletKey) return null;
  const raw = config.hotWalletKey.startsWith('0x')
    ? config.hotWalletKey
    : `0x${config.hotWalletKey}`;
  try {
    const account = privateKeyToAccount(raw as `0x${string}`);
    const rpcUrl = config.rpcUrl || DEFAULT_RPC;
    return createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  } catch {
    return null;
  }
}

function getPublicClient(config: SettlementConfig) {
  const rpcUrl = config.rpcUrl || DEFAULT_RPC;
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

/**
 * Submit the human's signed EIP-2612 permit on-chain.
 * This sets the USDC allowance for the treasury to spend the human's USDC.
 */
export async function submitPermit(
  params: {
    owner: string;
    spender: string;
    value: bigint;
    deadline: number;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  },
  config: SettlementConfig,
): Promise<SettlementResult> {
  const walletClient = getWalletClient(config);
  if (!walletClient) {
    return { ok: false, error: 'HOT_WALLET_PRIVATE_KEY not set — settlement disabled' };
  }

  try {
    const hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'permit',
      args: [
        params.owner as `0x${string}`,
        params.spender as `0x${string}`,
        params.value,
        BigInt(params.deadline),
        params.v,
        params.r,
        params.s,
      ],
    });

    const publicClient = getPublicClient(config);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: receipt.status === 'success',
      txHash: hash,
      gasCost: receipt.effectiveGasPrice ? receipt.gasUsed.toString() : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Permit submission failed: ${msg}` };
  }
}

/**
 * Execute transferFrom to move USDC from the human's wallet to the treasury.
 */
export async function settleCall(
  humanAddress: string,
  amountAtomic: bigint,
  config: SettlementConfig,
): Promise<SettlementResult> {
  const walletClient = getWalletClient(config);
  if (!walletClient) {
    return { ok: false, error: 'HOT_WALLET_PRIVATE_KEY not set — settlement disabled' };
  }

  try {
    const publicClient = getPublicClient(config);

    // Check current allowance first
    const currentAllowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'allowance',
      args: [humanAddress as `0x${string}`, config.treasuryAddress as `0x${string}`],
    });

    if (currentAllowance < amountAtomic) {
      return { ok: false, error: `Insufficient allowance: ${currentAllowance} < ${amountAtomic}` };
    }

    const hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transferFrom',
      args: [
        humanAddress as `0x${string}`,
        config.treasuryAddress as `0x${string}`,
        amountAtomic,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: receipt.status === 'success',
      txHash: hash,
      gasCost: receipt.effectiveGasPrice ? receipt.gasUsed.toString() : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Settlement failed: ${msg}` };
  }
}
