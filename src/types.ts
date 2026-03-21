/**
 * GENESIS-GAS-BUFFER — Type Definitions
 *
 * War chest management. Multi-chain gas allocation for swarm operations.
 * Auto-refill from alpha yield. Keeps the troops fed.
 */

/** Supported chains for gas allocation */
export type Chain =
  | "ETHEREUM"
  | "SOLANA"
  | "BSC"
  | "POLYGON"
  | "ARBITRUM"
  | "OPTIMISM"
  | "AVALANCHE"
  | "BASE"
  | "TRON";

/** Per-chain gas allocation */
export interface ChainAllocation {
  chain: Chain;
  /** Current gas balance in native token */
  balanceNative: number;
  /** Current gas balance in USD */
  balanceUsd: number;
  /** Floor — minimum gas below which swarm pauses on this chain */
  floorUsd: number;
  /** Ceiling — excess above this flows to command wallet */
  ceilingUsd: number;
  /** Total gas dispensed to operators on this chain */
  totalDispensedUsd: number;
  /** Total gas received from alpha yield */
  totalReceivedUsd: number;
  /** Number of operators funded from this chain */
  operatorsFunded: number;
  /** Is this chain operational? (below floor = paused) */
  operational: boolean;
  lastUpdated: string;
}

/** Gas dispense request — when DARPA dispatches an operator */
export interface DispenseRequest {
  operatorId: string;
  missionId: string;
  chain: Chain;
  /** Requested gas amount in USD */
  amountUsd: number;
  /** Operator wallet address to fund */
  walletAddress: string;
}

/** Gas dispense result */
export interface DispenseResult {
  id: string;
  operatorId: string;
  missionId: string;
  chain: Chain;
  amountUsd: number;
  amountNative: number;
  walletAddress: string;
  txHash?: string;
  status: "DISPENSED" | "REJECTED_BELOW_FLOOR" | "REJECTED_INSUFFICIENT" | "FAILED";
  reason?: string;
  timestamp: string;
}

/** Alpha yield deposit — when profits arrive for the buffer */
export interface AlphaDeposit {
  source: string;         // e.g., "beachhead-executor", "swarm-operator-xyz"
  missionId?: string;
  totalAlphaUsd: number;  // Total alpha from the mission
  bufferShareUsd: number; // 10% (or configured %) allocated to buffer
  chain: Chain;           // Which chain to top up
  timestamp: string;
}

/** Buffer state summary */
export interface BufferState {
  totalBalanceUsd: number;
  totalDispensedUsd: number;
  totalReceivedUsd: number;
  alphaSharePercent: number;
  chains: ChainAllocation[];
  operationalChains: number;
  pausedChains: number;
  totalOperatorsFunded: number;
  lastDepositAt: string | null;
  lastDispenseAt: string | null;
  uptime: number;
}
