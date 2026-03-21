/**
 * GENESIS-GAS-BUFFER — War Chest Management
 *
 * "Keeps the troops fed."
 *
 * Multi-chain gas allocation for swarm operations.
 * Auto-refill from alpha yield (default 10%).
 * Floor/ceiling thresholds per chain.
 * Below floor = swarm pauses on that chain. No starvation deaths.
 * Above ceiling = excess flows to command wallet. No idle capital.
 *
 * The buffer is a living thing — always being drained by operations,
 * always being refilled by alpha. Self-sustaining war economy.
 *
 * Port: 8690
 */

import express from "express";
import { AllocationService } from "./services/allocation.service";
import type { DispenseRequest, AlphaDeposit, Chain } from "./types";

const PORT = parseInt(process.env.PORT || "8690", 10);

const app = express();
app.use(express.json());

const allocator = new AllocationService();

// ── POST /deposit — Alpha yield flows into the buffer ──
// Called by executors/operators after successful trades.
// Accepts total alpha, calculates buffer share automatically.
app.post("/deposit", (req, res) => {
  const body = req.body;

  if (!body.source || !body.chain || typeof body.totalAlphaUsd !== "number") {
    res.status(400).json({
      accepted: false,
      reason: "Required: source, chain, totalAlphaUsd",
    });
    return;
  }

  const bufferShareUsd = allocator.calculateBufferShare(body.totalAlphaUsd);

  const deposit: AlphaDeposit = {
    source: body.source,
    missionId: body.missionId,
    totalAlphaUsd: body.totalAlphaUsd,
    bufferShareUsd,
    chain: body.chain as Chain,
    timestamp: new Date().toISOString(),
  };

  const result = allocator.deposit(deposit);

  res.status(200).json({
    accepted: result.accepted,
    totalAlphaUsd: body.totalAlphaUsd,
    bufferShareUsd: Math.round(bufferShareUsd * 100) / 100,
    newBalanceUsd: Math.round(result.newBalance * 100) / 100,
    chain: body.chain,
  });
});

// ── POST /dispense — Fund an operator with gas ──
// Called by DARPA when deploying an operator on a mission.
app.post("/dispense", (req, res) => {
  const body = req.body;

  if (!body.operatorId || !body.missionId || !body.chain || typeof body.amountUsd !== "number") {
    res.status(400).json({
      accepted: false,
      reason: "Required: operatorId, missionId, chain, amountUsd",
    });
    return;
  }

  if (!body.walletAddress) {
    res.status(400).json({
      accepted: false,
      reason: "Required: walletAddress",
    });
    return;
  }

  const request: DispenseRequest = {
    operatorId: body.operatorId,
    missionId: body.missionId,
    chain: body.chain as Chain,
    amountUsd: body.amountUsd,
    walletAddress: body.walletAddress,
  };

  const result = allocator.dispense(request);

  res.status(result.status === "DISPENSED" ? 200 : 409).json(result);
});

// ── GET /health ──
app.get("/health", (_req, res) => {
  const state = allocator.getState();

  res.json({
    service: "genesis-gas-buffer",
    status: state.operationalChains > 0 ? "GREEN" : "AMBER",
    role: "WAR_CHEST_MANAGEMENT",
    totalBalanceUsd: state.totalBalanceUsd,
    operationalChains: state.operationalChains,
    pausedChains: state.pausedChains,
    totalOperatorsFunded: state.totalOperatorsFunded,
    alphaSharePercent: state.alphaSharePercent,
    totalReceivedUsd: state.totalReceivedUsd,
    totalDispensedUsd: state.totalDispensedUsd,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /state — Full buffer state ──
app.get("/state", (_req, res) => {
  const state = allocator.getState();

  res.json({
    buffer: state,
    recentDispenses: allocator.getDispenseHistory(20),
    recentDeposits: allocator.getDepositHistory(20),
  });
});

// ── GET /chain/:chain — Get specific chain allocation ──
app.get("/chain/:chain", (req, res) => {
  const chain = req.params.chain.toUpperCase() as Chain;
  const alloc = allocator.getChainAllocation(chain);

  if (!alloc) {
    res.status(404).json({ error: `Unknown chain: ${chain}` });
    return;
  }

  res.json({
    chain: alloc,
    operational: alloc.operational,
    canFund: alloc.balanceUsd > alloc.floorUsd,
  });
});

// ── GET /operational — Which chains can currently fund operators? ──
app.get("/operational", (_req, res) => {
  const state = allocator.getState();

  res.json({
    operational: state.chains.filter(c => c.operational).map(c => ({
      chain: c.chain,
      balanceUsd: Math.round(c.balanceUsd * 100) / 100,
      headroomUsd: Math.round((c.balanceUsd - c.floorUsd) * 100) / 100,
    })),
    paused: state.chains.filter(c => !c.operational).map(c => ({
      chain: c.chain,
      balanceUsd: Math.round(c.balanceUsd * 100) / 100,
      neededUsd: Math.round((c.floorUsd - c.balanceUsd) * 100) / 100,
    })),
  });
});

// ── GET /history/dispenses — Dispense history ──
app.get("/history/dispenses", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json({ dispenses: allocator.getDispenseHistory(limit) });
});

// ── GET /history/deposits — Deposit history ──
app.get("/history/deposits", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json({ deposits: allocator.getDepositHistory(limit) });
});

// ── Start ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[GAS-BUFFER] Genesis Gas Buffer listening on port ${PORT}`);
  console.log(`[GAS-BUFFER] Role: WAR_CHEST_MANAGEMENT`);
  console.log(`[GAS-BUFFER] Alpha share: ${process.env.ALPHA_SHARE_PERCENT || "10"}%`);
  console.log(`[GAS-BUFFER] Endpoints: /deposit, /dispense, /health, /state, /operational, /chain/:chain`);
  console.log(`[GAS-BUFFER] Doctrine: Keeps the troops fed. Self-sustaining war economy.`);
});
