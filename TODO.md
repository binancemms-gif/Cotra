# Cotra — TODO / outcome tracking

All outcomes remain open until there is evidence of the requested behavior. These criteria retain the user's complete supplied scope; do not represent unavailable feeds or unimplemented capabilities as complete.

## Evidence-backed implementation slice

- [x] **Read-only mainnet market observatory delivered** — The responsive Cotra website uses a fixed Helius mainnet RPC endpoint and verifies `getGenesisHash` against the observed Solana mainnet-beta genesis hash. The verified live endpoint returned `cluster: mainnet-beta`; DEX Screener returned real Solana profiles/pairs and source-reported price, volume, liquidity and transaction counts; GeckoTerminal returned real trending pools, newly created pools and OHLCV candles; Helius DAS and finalized Solana RPC returned real wrapped-SOL metadata, token-supply and mint-account fields. The wallet route returned finalized mainnet signatures with signatures/slots/timestamps and explicitly did not infer buy/sell intent. HTTP health returned 200 and `/manus-routes.json` returned the current three application routes. No market fallback fixtures are used in application code.
- [x] **Build and protected provider configuration delivered** — `pnpm check`, the production `pnpm build`, and the existing `pnpm test` suite succeeded. `HELIUS_API_KEY` remains a protected server runtime secret. The site mark, favicon and required application route manifest are included. These checks establish this implementation slice only; they do not complete the larger production acceptance groups below.

- [x] **User-requested mainnet RPC/WebSocket and live meme-coin trade stream** — Configure Cotra’s primary Solana mainnet HTTP RPC and WSS using the existing server-only `HELIUS_API_KEY`. Verify the exact mainnet-beta genesis hash before opening the WSS. Use one Helius connection with standard `logsSubscribe` filters for the Pump.fun bonding-curve and PumpSwap program addresses, one address per subscription, at `confirmed` commitment. Keep the upstream off by default; start it only after an explicit dashboard action while at least one same-origin live-feed viewer is connected, and stop after a 5-second idle grace period. Show the Helius usage rate before activation: 1 credit per new connection and 2 credits per 0.1 MB of uncompressed stream data; direct users to their Helius dashboard for actual usage. Ping the upstream connection and reconnect with bounded backoff. Only surface successful, program-scoped Buy/Sell instruction log observations; show source, program, signature, slot, confirmed commitment, observation time and Solana explorer link. Clearly mark the stream log-only: it does not itself supply mint, trader, token/SOL amount, price or durable history, so never invent those fields. Keep the key server-only, do not use Devnet, mock events, or sign/submit trades. Test the mainnet handshake, subscription acknowledgements and receipt of real matching mainnet log notifications; distinguish live, reconnecting and unavailable states. Live verification (2026-10-26): the stream began disabled; a cross-site start was rejected with 403 and a same-origin start without a viewer with 409; explicit start verified mainnet-beta and acknowledged both program subscriptions; one real Pump.fun `BuyExactQuoteInV3` event at slot 461829438 was cross-checked with confirmed Helius `getTransaction` (signature, slot, program and instruction matched; transaction error was null); explicit Stop returned to disabled. The five-second idle shutdown and reconnect recovery are implemented but were not forced in this live smoke run.

**Not delivered yet:** durable, gap-reconciled multi-instance transaction indexing/backfill, full historical wallet accounting and smart-money ranking, clusters, risk engine, persistent user accounts/watchlists/alerts, authorized delegated signing, automated copy execution, positions and PnL reconciliation, distributed multi-instance rate limiting, and production monitoring/operational SLAs. The new requested stream is a live, read-only, in-memory log monitor—not durable production ingestion. The copy-trading controls remain locked and no mainnet trade can be signed or submitted by this version. Keep their acceptance groups below open.

- [x] **Brand, reference projects, and requested GitHub destination** — The project is named Cotra and uses the requested teal illustration/signature color. The three supplied repositories were reviewed as product references only: https://github.com/Kelows/million, https://github.com/farfary/ScreenerBot, and https://github.com/TauricResearch/TradingAgents. The owner-confirmed private GitHub repository was created and connected as the canonical project repository: https://github.com/binancemms-gif/Cotra.

- [ ] **1. Mission** — Complete the full criteria below.

Build a production-grade, Solana-mainnet-native copy-trading platform focused on meme coins, newly launched tokens, smart-money intelligence, wallet tracking, token analytics, liquidity monitoring, and automated trade execution.

The platform must use REAL Solana mainnet data and REAL market data.

No testnet deployment, simulated market data, mock tokens, demo dashboards, or fake trading statistics.

Every displayed metric must originate from a real data source or a clearly identified calculation based on verified source data.

The application must be functional, not a static UI prototype.

- [ ] **2. Primary Objective** — Complete the full criteria below.

Build a platform that enables users to:

* Discover profitable Solana wallets.
* Track wallet activity in real time.
* Analyze token fundamentals and on-chain behavior.
* Inspect token metadata, logos, charts, liquidity, and TVL.
* Identify wallet clusters and suspicious trading activity.
* Automatically copy selected wallets’ trades.
* Configure trade sizes, execution limits, and risk controls.
* Monitor positions, realized PnL, unrealized PnL, and transaction history.
* Receive alerts for significant wallet and token events.

The architecture must support expansion into a broader Solana market-intelligence platform.

- [ ] **3. Mainnet Requirements** — Complete the full criteria below.

Use Solana mainnet-beta as the only supported network for the production application.

Use a dedicated production-grade Solana RPC provider with WebSocket or streaming support.

Do not rely on public shared RPC endpoints for sustained production workloads.

Support:

* Live blockchain subscriptions.
* Transaction decoding.
* Wallet balance updates.
* SPL Token and Token-2022 assets.
* Token mint and metadata resolution.
* Transaction signature tracking.
* Transaction confirmation and failure handling.
* Historical transaction retrieval.
* Automatic reconnection after dropped streams.
* Rate-limit handling.
* Backfill after interruptions.
* Duplicate-event detection.
* Data freshness monitoring.

Maintain a consistent distinction between processed, confirmed, and finalized transactions.

Every event should carry a signature, slot, timestamp when available, commitment status, and source.

Do not describe an event as confirmed before the relevant confirmation threshold has been reached.

- [ ] **4. Token Intelligence Page** — Complete the full criteria below.

Every token must have a detailed page.

Token identity

Display:

* Token logo.
* Token name.
* Token symbol.
* Full mint address.
* Copy-address action.
* Metadata URI.
* Token standard.
* Decimals.
* Total supply.
* Current supply where reliably available.
* Circulating supply where available and appropriately defined.
* Creator or update authority when identifiable.
* Token creation time when verifiable.
* Metadata verification status.
* Website.
* X/Twitter.
* Telegram.
* Discord.
* Other available social links.

Never assume that metadata or social links are legitimate simply because they exist.

Show missing or unverified fields explicitly.

Token market information

Display:

* Current price in USD and SOL.
* Market capitalization.
* Fully diluted valuation where calculable.
* Total liquidity.
* Pool-level liquidity.
* TVL when applicable.
* 24-hour trading volume.
* Buy volume and sell volume.
* Buy and sell transaction counts.
* Unique buyers and sellers where available.
* Price change over 5 minutes, 15 minutes, 1 hour, 4 hours, and 24 hours.
* Token age.
* Number of known liquidity pools.
* Supported trading venues.
* Recent large transactions.

Show the calculation method, source, and last-updated timestamp for important metrics.

Do not label a market-cap estimate as circulating market capitalization unless circulating supply is known.

- [ ] **5. Token Charting System** — Complete the full criteria below.

Build an interactive chart using TradingView Lightweight Charts or an equivalent charting library.

Required capabilities:

* Real-time price updates.
* Candlestick charts.
* OHLCV data.
* 1-minute, 5-minute, 15-minute, 1-hour, 4-hour, and daily intervals when the source supports them.
* Volume bars.
* Buy and sell markers.
* Wallet activity markers.
* Large transaction annotations.
* Liquidity changes.
* Token launch markers.
* Configurable chart time ranges.
* Historical candle loading.
* Live updates without unnecessary full-page refreshes.

Never fabricate missing candles or display stale prices as live.

Clearly indicate when historical data is incomplete or an update stream is disconnected.

- [ ] **6. Liquidity And Tvl Analytics** — Complete the full criteria below.

Build a dedicated liquidity intelligence module.

Track supported Solana liquidity venues, including relevant pools on:

* Raydium.
* Orca.
* Meteora.
* Pump.fun and its supported trading or migration infrastructure.
* Other supported Solana venues as integrations are added.

For every identified pool, display:

* Pool address.
* DEX or protocol.
* Token pair.
* Token reserves.
* USD liquidity estimate.
* Pool creation time when available.
* Trading volume.
* Recent liquidity additions.
* Recent liquidity withdrawals.
* Fees where available.
* Pool price.
* Price impact estimates where supported.

Distinguish pool TVL from lending-protocol TVL and token market capitalization.

Do not sum the same liquidity twice when aggregating across venues.

Alert users when liquidity falls sharply, concentrated liquidity changes, or a large withdrawal occurs.

Do not assume that all liquidity is permanently locked or safely withdrawable.

- [ ] **7. Smart-Money Wallet Intelligence** — Complete the full criteria below.

Create a wallet discovery and analytics engine.

Allow users to:

* Search by wallet address.
* Follow wallets.
* Group wallets into watchlists.
* Inspect historical transactions.
* Track token purchases and sales.
* Monitor current holdings.
* Review realized and unrealized PnL.
* Compare wallet performance.
* Identify recurring token purchases.
* Track transfers between related wallets.
* Detect possible coordinated trading.
* Receive alerts for new positions and exits.

Calculate:

* Realized PnL.
* Unrealized PnL.
* Return on investment.
* Win rate.
* Average holding duration.
* Trade frequency.
* Average entry and exit price.
* Maximum drawdown when sufficient historical data exists.
* Performance over defined time periods.
* Estimated transaction costs.

Account for transaction fees, priority fees, failed transactions, partial fills, token transfers, liquidity constraints, and incomplete historical data.

Separate transfers from actual buys and sells.

Do not classify every incoming token transfer as a purchase or every outgoing transfer as a sale.

Do not rank wallets using unrealized gains alone.

Display the methodology, sample size, data coverage, and confidence of each performance metric.

- [ ] **8. Wallet Cluster Analysis** — Complete the full criteria below.

Build a wallet relationship graph.

Investigate:

* Shared funding wallets.
* Direct transfers between wallets.
* Common transaction patterns.
* Coordinated buying.
* Similar entry and exit timing.
* Token distribution patterns.
* Creator-linked wallets.
* Concentrated ownership.
* Possible insider or bundled launch activity.

Represent relationships as evidence-based connections.

Distinguish a confirmed on-chain relationship from a heuristic suspicion.

Do not label wallets as belonging to the same person without reliable evidence.

Provide an interactive graph with expandable wallet details and transaction links.

- [ ] **9. Token Security And Rug-Risk Engine** — Complete the full criteria below.

Build a multi-signal token risk assessment system.

Check, where applicable:

* Mint authority.
* Freeze authority.
* Token-2022 extensions.
* Transfer restrictions.
* Metadata mutability.
* Creator holdings.
* Top-holder concentration.
* Insider and cluster concentration.
* Liquidity depth.
* Liquidity withdrawal patterns.
* Holder distribution.
* Suspicious funding relationships.
* Abnormal buy and sell behavior.
* Pool age.
* Sellability and route availability.
* Large unexplained balance changes.
* Known malicious addresses where reliable intelligence exists.

Produce a transparent risk report with:

* Individual risk indicators.
* Severity levels.
* Evidence.
* Data freshness.
* Missing checks.
* Confidence level.
* Overall risk classification.

Do not promise that a token is safe.

Do not treat a third-party security score as proof of safety.

Re-evaluate risk immediately before executing a copy trade.

- [ ] **10. Automated Copy-Trading Engine** — Complete the full criteria below.

Build a real Solana-mainnet copy-trading engine.

Users must be able to select one or more wallets and configure independent copy-trading rules.

Configuration options:

* Fixed SOL amount per buy.
* Proportional sizing based on the observed trade.
* Maximum SOL allocation per trade.
* Maximum exposure per token.
* Maximum total exposure.
* Maximum daily loss.
* Maximum acceptable price impact.
* Maximum slippage.
* Minimum liquidity.
* Minimum pool age where appropriate.
* Maximum token age where appropriate.
* Token and wallet blocklists.
* Allowlisted trading venues.
* Minimum confidence threshold.
* Maximum transaction fees.
* Maximum concurrent positions.
* Buy and sell copying preferences.
* Emergency stop.
* Pause and resume.
* Close-position controls.

Support independent settings for every followed wallet.

Execution workflow

1. Detect a qualifying transaction from a followed wallet.
2. Decode the transaction and identify its actual economic effect.
3. Determine whether it represents a buy, sell, transfer, liquidity action, or another event.
4. Resolve the token mint and trading venue.
5. Refresh token, liquidity, price, and security data.
6. Determine whether the event qualifies under the user’s rules.
7. Calculate the intended trade size.
8. Request a fresh swap quote.
9. Check price impact, slippage, fees, route availability, and exposure limits.
10. Reject the trade if any mandatory safety condition fails.
11. Construct the transaction using an approved execution integration.
12. Sign and submit using the user’s authorized wallet configuration.
13. Track the transaction signature and confirmation state.
14. Reconcile the actual token and SOL balance changes.
15. Update positions, PnL, transaction history, and alerts.
16. Retry only when safe and when duplicate execution can be prevented.

Do not blindly mirror the observed transaction amount.

A copied trade must account for differences in wallet size, liquidity, price movement, and execution conditions.

Do not assume the source wallet’s exit can be replicated at the same price.

Execution reliability

Implement:

* Idempotency keys.
* Duplicate-signal suppression.
* Transaction-state tracking.
* Bounded retries.
* Stale-quote rejection.
* Nonce or blockhash validity handling as applicable.
* Failed-transaction reconciliation.
* Position reconciliation.
* Priority-fee controls.
* Route validation.
* Persistent execution logs.

Never submit duplicate buys simply because a confirmation notification was delayed.

- [ ] **11. Wallet Security** — Complete the full criteria below.

Use a non-custodial security architecture wherever possible.

Never:

* Request users’ seed phrases in the application.
* Store plaintext private keys in a database.
* expose signing credentials to frontend JavaScript.
* Put RPC provider secrets in client-side code.
* Allow arbitrary unsigned transaction payloads to be signed without validation.

For automated execution, support an explicit wallet authorization model.

If delegated signing is used, isolate signing credentials in a hardened service or secure signing provider.

Restrict what the signing service can execute.

Support revocation, spending limits, transaction auditing, and emergency shutdown.

Require explicit user consent before enabling automated mainnet trading.

- [ ] **12. Live Activity Feed** — Complete the full criteria below.

Create a live feed containing:

* New token launches.
* Token metadata updates.
* New liquidity pools.
* Large buys.
* Large sells.
* Followed-wallet transactions.
* Creator-wallet activity.
* Liquidity additions and withdrawals.
* Token holder changes.
* Significant wallet-cluster activity.
* Copy-trade execution status.
* Failed transactions.
* Security alerts.

Every event should display:

* Token logo where available.
* Token symbol and mint address.
* Event type.
* Wallet address.
* Transaction amount.
* Estimated USD value.
* Price at the event.
* Pool or venue.
* Timestamp.
* Transaction signature.
* Confirmation status.
* Link to a Solana explorer.

Use WebSockets or a reliable streaming mechanism for live updates.

Implement backfill and deduplication so reconnection does not create duplicate activity.

- [ ] **13. Dashboard** — Complete the full criteria below.

Build a premium, information-dense Web3 dashboard.

Overview cards

* Total tracked wallets.
* Active followed wallets.
* New token launches.
* Total monitored liquidity.
* Number of active copy-trading positions.
* Realized PnL.
* Unrealized PnL.
* Recent wallet activity.
* Recent security alerts.

Navigation

* Overview.
* Live market.
* Token explorer.
* Token detail.
* Wallet explorer.
* Smart money.
* Wallet clusters.
* Liquidity analytics.
* Copy trading.
* Positions.
* Transaction history.
* Alerts.
* Risk monitoring.
* Settings.

Include:

* Global token and wallet search.
* Network and data-source status.
* Last-updated timestamps.
* Responsive desktop and mobile layouts.
* Clear loading, error, and stale-data states.
* Explorer links.
* Token logos and wallet identifiers.
* Filters and sortable tables.

Do not hide critical risk information behind decorative graphics.

- [ ] **14. Backend And Data Architecture** — Complete the full criteria below.

Use a modular, production-oriented architecture.

Suggested components:

* TypeScript backend services.
* Dedicated Solana RPC and streaming integration.
* PostgreSQL for durable application records.
* TimescaleDB or equivalent time-series storage where justified.
* Redis for caching, rate limits, and transient coordination.
* A durable event queue for processing blockchain events.
* WebSocket gateway for client updates.
* Separate market-data and transaction-ingestion services.
* Isolated execution and signing services.
* Centralized logging, metrics, and alerting.

Use normalized token, wallet, pool, transaction, position, and execution records.

Persist raw transaction references and normalized decoded events so historical calculations can be audited.

Separate raw on-chain observations from calculated metrics.

Make data providers replaceable through defined interfaces.

- [ ] **15. Real-Time Data Quality** — Complete the full criteria below.

Every data source must have:

* A documented schema.
* Rate-limit handling.
* Retry policy.
* Data freshness measurements.
* Error monitoring.
* Source attribution.
* Reconnection logic.
* Historical recovery.
* Duplicate detection.

Do not silently replace unavailable live data with fabricated values.

If a provider fails, mark the relevant metric as stale or unavailable.

For important financial metrics, distinguish:

* Source-reported values.
* Independently calculated values.
* Estimates.
* Missing or unverified values.

- [ ] **16. Monitoring And Operations** — Complete the full criteria below.

Implement:

* Service health checks.
* RPC connectivity monitoring.
* Stream-lag monitoring.
* Database health checks.
* Failed execution alerts.
* Unexpected balance-change alerts.
* Transaction reconciliation.
* Error reporting.
* Structured audit logs.
* Resource monitoring.
* Backup and recovery procedures.
* Secret rotation.
* Rate-limit monitoring.

Alert the operator when market data is stale, wallet monitoring stops, transaction ingestion falls behind, or execution services become unavailable.

- [ ] **17. Acceptance Criteria** — Complete the full criteria below.

The platform is not complete merely because the UI loads.

The implementation must demonstrate that:

1. Real mainnet token information can be loaded by mint address.
2. Token logos and metadata are resolved when available.
3. Current prices and liquidity are sourced from real providers.
4. Charts load real historical candles and receive live updates.
5. Wallet transactions are decoded and classified correctly.
6. Pool liquidity and TVL are not incorrectly conflated.
7. Wallet analytics account for transfers and transaction costs.
8. Wallet clusters show evidence behind each relationship.
9. Copy-trading rules are enforced server-side.
10. Duplicate transactions are prevented.
11. Failed and delayed transactions are reconciled.
12. Signing credentials are protected.
13. Every displayed financial metric has a source or calculation method.
14. The application reports outages and stale data accurately.
15. All mainnet execution is explicitly authorized and auditable.

- [ ] **18. Implementation Priority** — Complete the full criteria below.

Build in this order:

PHASE 1 — Mainnet data foundation
Token metadata, live prices, charts, liquidity, pools, wallet balances, and transaction ingestion.

PHASE 2 — Intelligence
Wallet analytics, historical PnL, smart-money discovery, token security, and cluster analysis.

PHASE 3 — Copy trading
Wallet-following rules, real transaction execution, position tracking, risk limits, and emergency controls.

PHASE 4 — Production hardening
Monitoring, performance optimization, reconciliation, security review, and operational reliability.

Use actual working integrations throughout. Do not substitute mock responses or fabricated dashboard data.

Before implementing a provider integration, inspect its current official documentation, supported endpoints, authentication requirements, rate limits, and commercial-use terms.

Deliver a working mainnet application with documented setup instructions, environment variables, database migrations, deployment instructions, and operational runbooks.
