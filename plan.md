# Cotra — implementation and design plan

## Scope and constraints

Cotra is a Solana-mainnet-only market-intelligence and copy-trading application. The supplied brief is the full product target. The implementation will proceed in the stated order: (1) real mainnet data foundation; (2) wallet intelligence and transparent security/risk signals; (3) copy-trading rules, signing/execution and positions; (4) operations hardening. A surface is not complete merely because it renders. No sample market rows, synthetic candles, fabricated balances, PnL, launches, or “demo” activity may be rendered as product data. If no source supports a metric or it is stale/unavailable, show that fact explicitly.

The first deliverable is a working read-only mainnet data foundation with real token lookup, real market/pool data, supported real historical OHLCV and the responsive market dashboard. Wallet-performance, clusters and actual copy execution are separately gated by verified historical coverage, user-owned wallet data, signing-provider decisions, provider credentials and explicit authorization. Until signing architecture and explicit opt-in exist, there will be no mainnet transaction submission, hidden paper trading, custody of keys, seed phrase field, or UI suggesting that trading is armed.

## Data providers and trust boundaries

- **Solana mainnet RPC, metadata and transaction streams:** Helius, called only from the server with `HELIUS_API_KEY`. All chain calls explicitly use mainnet-beta. Use its DAS `getAsset` for available mint/metadata fields, and native RPC for independently verifiable mint/account/supply state and supported subscriptions. Never treat its documented cached `token_info.price_info` (which can be up to 600 seconds old) as real-time price. Use transaction/signature/account stream methods only to the extent enabled by the provisioned plan; attach signature, slot, available timestamp, commitment and source; recover gaps through history when supported.
- **Current market/pair data:** DEX Screener API for documented Solana token/pair price, volume, trades, FDV, liquidity and available profile/logo fields. Source attribution and response timestamps will be visible. Its official pair/token endpoints are rate limited; use bounded server-side caching and per-client limits. Unverified social metadata remains explicitly unverified.
- **Pool data and historical candles:** GeckoTerminal API v2-beta (`solana` network) for documented pool, token, trade and OHLCV endpoints, with `Accept: application/json;version=20230203`. The official docs describe a public rate limit of about 10 calls/minute, a one-minute cache, and a beta API; use conservative rate-limited polling. Request only supported intervals and leave unsupported/incomplete ranges empty. Do not imply this public endpoint satisfies sustained production throughput; operations documentation must identify its limitation and supported paid upgrade path without pretending a key is configured.
- **Execution:** No signing integration will be selected or activated without an explicit owner decision. Jupiter Swap API is a potential replaceable quote/build integration, but the official docs distinguish its routed modes, production key/rate requirements and transaction signing/landing. A quote is not an executed trade. No signing key is stored in application database or frontend code. A future executor must enforce policies server-side, check quotes/risk immediately before execution, be idempotent and reconcile finalized on-chain balances.
- Providers sit behind replaceable server interfaces. Credentials use the protected secret service only. The frontend receives derived data, provenance, freshness and safe explorer URLs, never RPC/provider secrets.

## Application structure

- `client/src/pages/` and `client/src/components/`: responsive teal Cotra dashboard, token lookup/detail, market/pool and chart surfaces, wallet/cluster/copy-trading/position areas with honest availability and empty/error states.
- `server/providers/`: schema-checked Helius, DEX Screener and GeckoTerminal clients; mainnet-only invariants, attribution, retry/backoff, rate limits, deduplication and timestamps.
- `server/routers/` (or the project's existing `server/routers.ts`): bounded public read-only market/token procedures; user-owned state procedures only where authenticated. Never expose provider credentials or trading/signing procedures without explicit gating.
- `drizzle/schema.ts`, `server/db.ts`, `drizzle/`: durable normalized token/wallet/pool/observation/transaction/watchlist/alert/execution records as features are implemented. Keep raw observations distinct from derived estimates; migrations additive and deterministic. Development and publication share the selected database, so avoid destructive schema/data actions.
- `public/manus-routes.json`: source-aligned page route manifest required before dev-server startup.
- `README.md`, `docs/`: provider variables, mainnet-only rules, data/methodology caveats, setup/migrations/deployment/runbooks and explicit trade-execution authorization/security gates.

## Design

- **Design Movement:** A high-signal market terminal with restrained industrial-fintech typography, adapted to Solana-native real-time telemetry rather than a generic exchange template.
- **Core Principles:** provenance before polish; dense information with clear hierarchy; risk and stale-state visibility; automation must be opt-in and auditable.
- **Color Philosophy:** Deep evergreen-black surfaces and warm neutral text keep high-volume market data legible, while teal owns active/live state and connective on-chain signals. Green/red are reserved for positive/negative price changes, not brand identity. The signature teal is `#23D6BE`.
- **Layout Paradigm:** Narrow persistent rail plus an asymmetric, resizable-feeling workspace: a primary market/chart canvas, compact right-side stream/health column and full-width data tables as needed. On phones, the rail becomes a compact tab bar and dense tables become deliberate horizontal/stacked views.
- **Signature Elements:** A C-shaped paired-node mark; subtle teal connector traces tying real wallet/pool events to token rows; fine mono source/freshness labels adjacent to the corresponding values.
- **Interaction Philosophy:** Search is primary; address and mint values are copyable; rows open evidence/detail panels; all active trade-control affordances expose disabled prerequisites until checks pass. No simulated “live” motion.
- **Animation:** Brief, low-amplitude highlight on actual arriving data only; respect reduced-motion; never animate stale prices or imply chain confirmation before commitment state.
- **Typography System:** Space Grotesk for headings and Inter for UI/body, with IBM Plex Mono for mint addresses, quantities and source/status metadata.
- **Brand Essence:** “Read the chain clearly; follow capital with evidence.” For Solana-native token researchers and cautious wallet followers. Personality: precise, alert, accountable.
- **Brand Voice:** Concise, factual and explicit about uncertainty. Example lines: “Mainnet data, source by source.” “Stream delayed; last verified at 16:42:10 UTC.”
- **Wordmark & Logo:** Custom geometric Cotra wordmark paired with a small paired-node C monogram; teal used sparingly as the signature accent.
- **Signature Brand Color:** `#23D6BE` teal.

## Implementation approach

Keep the provided React/Express/tRPC/Drizzle starter and selected managed MySQL database. Implement read-only provider adapters and safe server procedures before connecting screens. Display source and data freshness for every financial observation; use distinct labels for source-reported values, calculation/estimate, missing checks and stale results. Provide actionable retries for RPC/provider failures. Do not seed fictitious launch, wallet, liquidity or PnL rows.

Start the dev process only after the routes manifest, plan, and approved ToDo exist. Configure the initialized TypeScript diagnostics (already confirmed registered). After real-data UI and procedures are in place, run existing TypeScript/tests and relevant build checks, inspect source-to-client boundaries, inspect `/manus-routes.json` as JSON, and obtain a read-only requirement review because the product spans multiple integrations.

## Material dependencies and unresolved gates

1. A Helius API key is not currently configured; mainnet-backed Helius lookup/streaming cannot be exercised until the owner supplies one through the protected secret-entry card. Do not request it in chat or check it into files.
2. GeckoTerminal’s free public API has roughly 10 calls/minute, one-minute cache, and beta status. It is suitable only for conservative read-only charting in this initial foundation; production streaming/frequency requirements require a supported provider plan/data arrangement.
3. No authenticated signing provider, delegated authorization, execution limits or user wallet authorization has been selected. Mainnet copy trading must remain unarmed until a secure model is chosen and explicitly authorized; this is a material prerequisite, not a UI-only toggle.
4. GitHub publication is requested as repository `Cotra`. Use the managed repository-transfer confirmation flow; it can create a new private repository after the owner confirms the target. Do not use `gh repo create` or claim the repository is connected until the transfer completes.
5. The three linked references are product/architecture inspirations only: Million describes itself as an experimental local Solana whale/copy-trading tool; ScreenerBot describes a self-hosted Rust Solana screener/trader with local-key security; TradingAgents is a general LLM financial research framework whose described portfolio order is routed to a simulated exchange. Cotra will adapt product patterns only and not import their code.
