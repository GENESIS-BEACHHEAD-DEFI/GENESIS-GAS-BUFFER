# GENESIS-GAS-BUFFER
### War Chest Management -- Multi-Chain Gas Allocation

**Port: 8690**

> "Keeps the troops fed. Self-sustaining war economy."

## What It Does

1. **Multi-chain gas allocation** for swarm operations across 9 blockchains (Ethereum, Solana, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base, Tron) with per-chain balance tracking
2. **Auto-refill from alpha yield** -- configurable percentage (default 10%) of every profitable trade flows into the gas buffer; self-sustaining war economy where operations fund further operations
3. **Floor/ceiling thresholds per chain** -- below floor (e.g., Ethereum $10, Solana $1) the swarm pauses on that chain to prevent starvation; above ceiling (e.g., Ethereum $100, Solana $20) excess flows to command wallet to avoid idle capital
4. **Operator gas dispensing** -- DARPA calls POST `/dispense` when deploying operators; buffer validates against floor threshold and available balance before releasing gas
5. **Operational status per chain** -- real-time tracking of which chains can fund operators and which are paused; GET `/operational` shows headroom on active chains and deficit on paused chains
6. **Full compliance trail** -- every deposit and dispense event recorded to GTC (telemetry) and Ledger Lite (compliance) with SHA-256 payload hashing

## Architecture

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Express server, 8 endpoints: deposit, dispense, health, state, chain detail, operational status, dispense/deposit history | 185 |
| `src/types.ts` | Chain type (9 chains), ChainAllocation, DispenseRequest/Result, AlphaDeposit, BufferState | 92 |
| `src/services/allocation.service.ts` | Per-chain allocation management: deposit/dispense logic, floor/ceiling enforcement, GTC/Ledger Lite forwarding | 350 |
| `package.json` | Dependencies: express | 20 |
| `Dockerfile` | node:20.20.0-slim, port 8690 | 9 |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/deposit` | Alpha yield flows into the buffer (calculates buffer share automatically) |
| POST | `/dispense` | Fund an operator with gas on a specific chain |
| GET | `/health` | Service health, total balance, operational/paused chains, operators funded |
| GET | `/state` | Full buffer state with recent dispenses and deposits |
| GET | `/chain/:chain` | Get specific chain allocation details |
| GET | `/operational` | Which chains can currently fund operators (with headroom/deficit) |
| GET | `/history/dispenses` | Dispense history |
| GET | `/history/deposits` | Deposit history |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8690` | Service port |
| `ALPHA_SHARE_PERCENT` | `10` | Percentage of alpha yield allocated to gas buffer |
| `GTC_URL` | `http://genesis-beachhead-gtc:8650` | Telemetry forwarding |
| `LEDGER_LITE_URL` | `http://genesis-ledger-lite:8500` | Compliance recording |

## Integration

- **Receives from**: Executors/operators (POST `/deposit` with alpha yield), DARPA (POST `/dispense` for operator deployment)
- **Writes to**: GTC (deposit/dispense/reject telemetry), Ledger Lite (financial compliance)
- **Called by**: Mothership (gas requests for all 7 operator classes), DARPA (direct operator funding)

## Current State

- BUILT and wired into docker-compose
- 9 chains initialised with floor/ceiling thresholds
- All chains start at $0 balance (below floor = paused until first alpha deposit)
- Auto-refill at 10% of alpha yield
- Full deposit/dispense history with bounded memory (1000 deposits, 2000 dispenses)
- Floor enforcement: rejects dispenses that would breach minimum, pauses chain operations

## Future Editions

1. Native token conversion: actual on-chain gas dispensing via private key signing
2. Dynamic floor/ceiling adjustment based on chain activity and gas price volatility
3. Cross-chain rebalancing: move excess gas from cheap chains to expensive chains
4. Predictive gas budgeting: forecast gas needs based on upcoming campaign schedules
5. Real-time gas price feeds: adjust floor/ceiling based on live gas market conditions

## Rail Deployment

| Rail | Status | Notes |
|------|--------|-------|
| Rail 1 (Cash Rail) | BUILT | 9 chains, floor/ceiling, alpha auto-refill, USD tracking |
| Rail 2 (DeFi) | Planned | Native token dispensing with private key management |
| Rail 3+ | Future | GOD/Ray Trace dashboard for cross-chain gas topology |
