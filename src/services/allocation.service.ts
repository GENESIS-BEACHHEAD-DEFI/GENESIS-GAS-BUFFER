/**
 * GENESIS-GAS-BUFFER — Allocation Service
 *
 * Manages per-chain gas allocations. Tracks balances, enforces floor/ceiling,
 * handles deposits from alpha yield and dispenses to operators.
 *
 * The war chest — always being drained by operations, always being refilled by alpha.
 * Self-sustaining war economy.
 */

import { randomUUID, createHash } from "crypto";
import type {
  Chain,
  ChainAllocation,
  DispenseRequest,
  DispenseResult,
  AlphaDeposit,
  BufferState,
} from "../types";

const ALPHA_SHARE_PERCENT = parseFloat(process.env.ALPHA_SHARE_PERCENT || "10");
const GTC_URL = process.env.GTC_URL || "http://genesis-beachhead-gtc:8650";
const LEDGER_LITE_URL = process.env.LEDGER_LITE_URL || "http://genesis-ledger-lite:8500";

/** Default chain configurations — floor/ceiling per chain */
const DEFAULT_CHAINS: Record<Chain, { floorUsd: number; ceilingUsd: number }> = {
  ETHEREUM: { floorUsd: 10, ceilingUsd: 100 },     // Gas expensive, keep tight
  SOLANA: { floorUsd: 1, ceilingUsd: 20 },          // Gas pennies, low floor
  BSC: { floorUsd: 2, ceilingUsd: 30 },
  POLYGON: { floorUsd: 1, ceilingUsd: 20 },
  ARBITRUM: { floorUsd: 2, ceilingUsd: 30 },
  OPTIMISM: { floorUsd: 2, ceilingUsd: 30 },
  AVALANCHE: { floorUsd: 2, ceilingUsd: 30 },
  BASE: { floorUsd: 1, ceilingUsd: 20 },
  TRON: { floorUsd: 1, ceilingUsd: 20 },
};

export class AllocationService {
  private allocations: Map<Chain, ChainAllocation> = new Map();
  private dispenseHistory: DispenseResult[] = [];
  private depositHistory: AlphaDeposit[] = [];
  private lastDepositAt: string | null = null;
  private lastDispenseAt: string | null = null;
  private totalOperatorsFunded = 0;

  constructor() {
    // Initialise all chain allocations at zero balance
    for (const [chain, config] of Object.entries(DEFAULT_CHAINS)) {
      this.allocations.set(chain as Chain, {
        chain: chain as Chain,
        balanceNative: 0,
        balanceUsd: 0,
        floorUsd: config.floorUsd,
        ceilingUsd: config.ceilingUsd,
        totalDispensedUsd: 0,
        totalReceivedUsd: 0,
        operatorsFunded: 0,
        operational: false, // Below floor at start — no gas, no operations
        lastUpdated: new Date().toISOString(),
      });
    }

    console.log(
      `[GAS-BUFFER] Initialised ${this.allocations.size} chains — ` +
      `alpha share: ${ALPHA_SHARE_PERCENT}%`,
    );
  }

  /**
   * Deposit alpha yield into the buffer.
   * Called when profits arrive — 10% goes to gas buffer.
   */
  deposit(deposit: AlphaDeposit): { accepted: boolean; newBalance: number } {
    const alloc = this.allocations.get(deposit.chain);
    if (!alloc) {
      return { accepted: false, newBalance: 0 };
    }

    alloc.balanceUsd += deposit.bufferShareUsd;
    alloc.totalReceivedUsd += deposit.bufferShareUsd;
    alloc.lastUpdated = new Date().toISOString();

    // Check if we've risen above floor — chain becomes operational
    if (alloc.balanceUsd >= alloc.floorUsd && !alloc.operational) {
      alloc.operational = true;
      console.log(
        `[GAS-BUFFER] CHAIN_OPERATIONAL ${deposit.chain} — balance $${alloc.balanceUsd.toFixed(2)} >= floor $${alloc.floorUsd}`,
      );
    }

    // Check if we've exceeded ceiling — excess should flow to command wallet
    let excessUsd = 0;
    if (alloc.balanceUsd > alloc.ceilingUsd) {
      excessUsd = alloc.balanceUsd - alloc.ceilingUsd;
      alloc.balanceUsd = alloc.ceilingUsd;
      console.log(
        `[GAS-BUFFER] CEILING_HIT ${deposit.chain} — $${excessUsd.toFixed(2)} excess → command wallet`,
      );
    }

    this.lastDepositAt = new Date().toISOString();
    this.depositHistory.push(deposit);

    // Keep history bounded
    if (this.depositHistory.length > 1000) {
      this.depositHistory = this.depositHistory.slice(-500);
    }

    console.log(
      `[GAS-BUFFER] DEPOSIT ${deposit.chain} +$${deposit.bufferShareUsd.toFixed(2)} ` +
      `from ${deposit.source} — balance now $${alloc.balanceUsd.toFixed(2)}`,
    );

    // Log to GTC
    this.postToGtc("GAS_BUFFER_DEPOSIT", {
      chain: deposit.chain,
      source: deposit.source,
      missionId: deposit.missionId,
      totalAlphaUsd: deposit.totalAlphaUsd,
      bufferShareUsd: deposit.bufferShareUsd,
      excessToCommandUsd: excessUsd,
      newBalanceUsd: alloc.balanceUsd,
    });

    // Log financial event to Ledger Lite
    this.postToLedgerLite("GAS_BUFFER_DEPOSIT", {
      chain: deposit.chain,
      source: deposit.source,
      bufferShareUsd: deposit.bufferShareUsd,
      excessToCommandUsd: excessUsd,
      newBalanceUsd: alloc.balanceUsd,
    });

    return { accepted: true, newBalance: alloc.balanceUsd };
  }

  /**
   * Dispense gas to an operator being deployed.
   * Called by DARPA when launching a mission.
   */
  dispense(request: DispenseRequest): DispenseResult {
    const alloc = this.allocations.get(request.chain);
    const now = new Date().toISOString();

    if (!alloc) {
      const result: DispenseResult = {
        id: randomUUID(),
        ...request,
        amountNative: 0,
        status: "FAILED",
        reason: `Unknown chain: ${request.chain}`,
        timestamp: now,
      };
      this.dispenseHistory.push(result);
      return result;
    }

    // Check floor — if dispensing would drop below floor, reject
    if (alloc.balanceUsd - request.amountUsd < alloc.floorUsd) {
      const result: DispenseResult = {
        id: randomUUID(),
        ...request,
        amountNative: 0,
        status: "REJECTED_BELOW_FLOOR",
        reason: `Balance $${alloc.balanceUsd.toFixed(2)} - request $${request.amountUsd.toFixed(2)} would drop below floor $${alloc.floorUsd}`,
        timestamp: now,
      };
      this.dispenseHistory.push(result);

      console.log(
        `[GAS-BUFFER] REJECTED ${request.chain} operator=${request.operatorId} — below floor`,
      );

      this.postToGtc("GAS_BUFFER_REJECT", {
        chain: request.chain,
        operatorId: request.operatorId,
        missionId: request.missionId,
        requestedUsd: request.amountUsd,
        balanceUsd: alloc.balanceUsd,
        floorUsd: alloc.floorUsd,
        reason: "BELOW_FLOOR",
      });

      return result;
    }

    // Check if sufficient balance
    if (alloc.balanceUsd < request.amountUsd) {
      const result: DispenseResult = {
        id: randomUUID(),
        ...request,
        amountNative: 0,
        status: "REJECTED_INSUFFICIENT",
        reason: `Insufficient balance: $${alloc.balanceUsd.toFixed(2)} < $${request.amountUsd.toFixed(2)} requested`,
        timestamp: now,
      };
      this.dispenseHistory.push(result);

      console.log(
        `[GAS-BUFFER] REJECTED ${request.chain} operator=${request.operatorId} — insufficient`,
      );

      return result;
    }

    // Dispense gas
    alloc.balanceUsd -= request.amountUsd;
    alloc.totalDispensedUsd += request.amountUsd;
    alloc.operatorsFunded++;
    alloc.lastUpdated = now;
    this.totalOperatorsFunded++;
    this.lastDispenseAt = now;

    // Check if we've dropped below floor — pause chain
    if (alloc.balanceUsd < alloc.floorUsd && alloc.operational) {
      alloc.operational = false;
      console.log(
        `[GAS-BUFFER] CHAIN_PAUSED ${request.chain} — balance $${alloc.balanceUsd.toFixed(2)} < floor $${alloc.floorUsd}`,
      );
    }

    const result: DispenseResult = {
      id: randomUUID(),
      ...request,
      amountNative: 0, // v1: USD tracking only. Future: native token conversion
      status: "DISPENSED",
      timestamp: now,
    };
    this.dispenseHistory.push(result);

    // Keep history bounded
    if (this.dispenseHistory.length > 2000) {
      this.dispenseHistory = this.dispenseHistory.slice(-1000);
    }

    console.log(
      `[GAS-BUFFER] DISPENSED ${request.chain} $${request.amountUsd.toFixed(2)} ` +
      `→ operator=${request.operatorId} mission=${request.missionId} — ` +
      `balance now $${alloc.balanceUsd.toFixed(2)}`,
    );

    // Log to GTC
    this.postToGtc("GAS_BUFFER_DISPENSE", {
      chain: request.chain,
      operatorId: request.operatorId,
      missionId: request.missionId,
      amountUsd: request.amountUsd,
      newBalanceUsd: alloc.balanceUsd,
      operational: alloc.operational,
    });

    // Log to Ledger Lite
    this.postToLedgerLite("GAS_BUFFER_DISPENSE", {
      chain: request.chain,
      operatorId: request.operatorId,
      missionId: request.missionId,
      amountUsd: request.amountUsd,
      newBalanceUsd: alloc.balanceUsd,
    });

    return result;
  }

  /**
   * Calculate buffer allocation from alpha yield.
   * Call this to determine how much of a profit goes to the buffer.
   */
  calculateBufferShare(totalAlphaUsd: number): number {
    return totalAlphaUsd * (ALPHA_SHARE_PERCENT / 100);
  }

  /**
   * Check if a chain is operational (above floor, can fund operators).
   */
  isChainOperational(chain: Chain): boolean {
    return this.allocations.get(chain)?.operational ?? false;
  }

  /**
   * Get full buffer state.
   */
  getState(): BufferState {
    const chains = Array.from(this.allocations.values());
    const totalBalanceUsd = chains.reduce((sum, c) => sum + c.balanceUsd, 0);
    const totalDispensedUsd = chains.reduce((sum, c) => sum + c.totalDispensedUsd, 0);
    const totalReceivedUsd = chains.reduce((sum, c) => sum + c.totalReceivedUsd, 0);
    const operationalChains = chains.filter(c => c.operational).length;

    return {
      totalBalanceUsd: Math.round(totalBalanceUsd * 100) / 100,
      totalDispensedUsd: Math.round(totalDispensedUsd * 100) / 100,
      totalReceivedUsd: Math.round(totalReceivedUsd * 100) / 100,
      alphaSharePercent: ALPHA_SHARE_PERCENT,
      chains,
      operationalChains,
      pausedChains: chains.length - operationalChains,
      totalOperatorsFunded: this.totalOperatorsFunded,
      lastDepositAt: this.lastDepositAt,
      lastDispenseAt: this.lastDispenseAt,
      uptime: Math.round(process.uptime()),
    };
  }

  getChainAllocation(chain: Chain): ChainAllocation | undefined {
    return this.allocations.get(chain);
  }

  getDispenseHistory(limit = 100): DispenseResult[] {
    return this.dispenseHistory.slice(-limit);
  }

  getDepositHistory(limit = 100): AlphaDeposit[] {
    return this.depositHistory.slice(-limit);
  }

  private postToGtc(eventType: string, data: Record<string, unknown>): void {
    const payload = {
      eventType,
      source: "genesis-gas-buffer",
      eventId: randomUUID(),
      payload: data,
      timestamp: new Date().toISOString(),
    };
    fetch(`${GTC_URL}/telemetry/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  private postToLedgerLite(eventType: string, data: Record<string, unknown>): void {
    const payload = {
      id: randomUUID(),
      rail: "BEACHHEAD" as const,
      eventType,
      source: "genesis-gas-buffer",
      timestamp: new Date().toISOString(),
      data,
    };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    fetch(`${LEDGER_LITE_URL}/payload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, payloadHash }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}
