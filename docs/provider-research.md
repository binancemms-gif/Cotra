# Cotra provider notes

Research checked 26 October 2026. This file records implementation-relevant official provider facts and the exact source URLs.

## Helius — Solana RPC and metadata

Official RPC endpoint reference: https://www.helius.dev/docs/api-reference/endpoints

Helius documents `https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY` for Solana mainnet. Its unified WebSocket endpoint documents standard Solana subscriptions and Helius extensions, but higher-level `transactionSubscribe` is plan-gated; websockets have a 10-minute inactivity timer and need a ping about once a minute. Cotra keeps the key server-side and verifies `getGenesisHash` against the known mainnet-beta hash before exposing provider health as verified.

Official DAS `getAsset` reference: https://www.helius.dev/docs/api-reference/das/getasset

Helius DAS can return metadata, ownership and on-chain attributes for a Solana digital asset. Its `token_info.price_info` is documented as cached up to 600 seconds and available for top-10k tokens by 24-hour volume. Cotra intentionally does not use that price field for current-price display. Any authority or supply fields not returned by DAS/RPC remain unavailable, not guessed.

## DEX Screener — pair market observations

Official API reference: https://docs.dexscreener.com/api/reference

The documented API includes latest token profiles, token pair lookup/bulk lookup, search and pair records. Returned pair schema includes price, transaction counts, volume, change, liquidity, FDV, market cap, creation time and selected profile links where supplied. The reference describes 60 requests/minute for profile endpoints and 300 requests/minute for pair/token/search endpoints. Those are provider-reported values and do not imply guaranteed uptime. Cotra filters profiles/pairs to `chainId === "solana"`, requests profiles and bulk token pairs conservatively, and tags values as DEX Screener source-reported data.

A profile/social URL is not proof of authenticity. `marketCap` is labeled source-reported and is not described as circulating market capitalization absent verified circulating supply. Pool liquidity is per returned pair; Cotra does not sum overlapping pair liquidity into a total.

## GeckoTerminal / CoinGecko Onchain API — pools and OHLCV

Official public API reference: https://api.geckoterminal.com/docs/index.html

The API documents `https://api.geckoterminal.com/api/v2`, version header `Accept: application/json;version=20230203`, trending/new pools, token/pool endpoints, trades and pool OHLCV at `/networks/{network}/pools/{pool_address}/ohlcv/{timeframe}`. The docs state all endpoints are cached for one minute, updates can arrive 2–3 seconds after confirmed transactions subject to network availability, and public access is limited to roughly 10 calls/minute with rates fluctuating. The API remains beta. Cotra labels chart data as GeckoTerminal pool OHLCV, keeps missing ranges missing and polls no more frequently than the cache policy; this is not represented as exchange-grade real-time streaming.

## Jupiter — possible future swap quotation/execution adapter

Official Swap API guide: https://developers.jup.ag/docs/swap

The currently documented API is `https://api.jup.ag/swap/v2`. Its Meta-Aggregator path uses `/order` and `/execute`; its Router path uses `/build` and `/submit` or another RPC. The docs say quote-only requests can be keyless but are limited to 0.5 requests/second; production needs an API key. A transaction must be signed by the user's wallet before execution. Cotra has not integrated signing or submission. Selecting Jupiter alone would not authorize automated execution or solve secure delegated signing.

## User-supplied project references

- https://github.com/Kelows/million — README describes a self-hosted Solana meme-coin wallet intelligence/copy-trading deck, experimental and local-first.
- https://github.com/farfary/ScreenerBot — README describes a Rust-based self-hosted Solana screener/trading product with copy-trading, local key handling and risk controls.
- https://github.com/TauricResearch/TradingAgents — README describes a general multi-agent financial research framework; its portfolio manager sends approved proposals to a simulated exchange. It is not a Solana on-chain execution implementation.

Cotra uses these as product references only. No source files were copied from those repositories.

## Current Cotra guardrails and scaling boundary

The current server bounds its response cache to 2,000 least-recently-used entries, limits in-flight distinct cache loads to 256, and applies per-route request limits keyed by Express's `req.ip`. Behind a reverse proxy, multiple clients may share that IP until trusted-hop handling is deliberately configured for the host; the app does not blindly trust arbitrary forwarded-IP headers. It also applies in-process upstream windows of 55 DEX Screener requests, 8 GeckoTerminal requests, and 120 Helius requests per rolling minute. These deliberately conservative controls reduce accidental/public abuse of the documented provider quotas in this single-process implementation. They are volatile and process-local: restarts reset them, and multiple replicas do not share counters. Public production serving at scale still needs a shared gateway/distributed limiter, durable operational monitoring and provider-specific production access.


## Helius mainnet WebSocket — Pump.fun and PumpSwap logs

Research checked 26 October 2026 for the requested live trade-stream setup.

Helius documents its unified mainnet WebSocket endpoint as `wss://mainnet.helius-rpc.com/?api-key=...` and its HTTP endpoint as `https://mainnet.helius-rpc.com/?api-key=...`; use the protected Helius key server-side for both. Helius supports standard Solana `logsSubscribe` on its WebSocket endpoint on all plans. Helius documents a ten-minute idle disconnect and recommends WebSocket pings about once per minute and reconnect logic. Cotra pings every 30 seconds and uses bounded exponential reconnection. Source: [Helius logsSubscribe](https://www.helius.dev/docs/api-reference/rpc/websocket/logssubscribe) and [Helius Pump AMM WebSocket guide](https://www.helius.dev/docs/rpc/websocket/stream-pump-amm-data).

The standard filter accepts `{ "mentions": ["<single pubkey>"] }`; each call supports exactly one address, so program monitors require separate subscriptions, which may share one WebSocket connection. Cotra subscribes at `confirmed` commitment and first validates mainnet-beta by matching Helius HTTP `getGenesisHash`. Standard log notifications contain signature, error status, slot and program log lines, but not the full transaction. This stream must not claim mint, wallet, token amount, SOL amount or price without separately retrieving and parsing the transaction. A log subscription is a live delivery mechanism, not a durable event log; reconnect gaps require a separate history/backfill pipeline that Cotra has not yet implemented. Source: [Solana logsSubscribe RPC reference](https://solana.com/docs/rpc/websocket/logssubscribe).

The Pump.fun bonding-curve program ID is `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; the PumpSwap AMM program ID is `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Helius’s Pump AMM streaming guide confirms the PumpSwap address and gives the Pump.fun bonding-curve address in its multi-stream example. The protocol’s own published trade documentation names current bonding-curve `buy_v3` / `sell_v3` and PumpSwap `buy_v2` / `sell_v2` variants; these can change as the protocol evolves. Cotra classifies only exact Buy/Sell instruction log messages while the corresponding program is on the invocation stack; other program activity is not labeled as a trade. Sources: [Helius Pump AMM streaming guide](https://www.helius.dev/docs/grpc/stream-pump-amm-data), [Pump.fun bonding-curve trade docs](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/TRADE_V3.md), and [PumpSwap trade docs](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/PUMP_SWAP_TRADE_V2.md).

Helius documents five simultaneous WSS connections on its Free plan and bills LaserStream streaming data by bytes. Cotra uses one upstream connection for the two program subscriptions; actual throughput and plan capacity still need monitoring. An approved stream connection is not a provider SLA or a complete transaction indexer. Source: [Helius WebSocket FAQ](https://www.helius.dev/docs/faqs/websockets).


### Helius WebSocket usage metering — billing clarification

The current Helius WebSockets FAQ and credit documentation state that opening a WebSocket connection costs 1 credit and streamed data—including standard Solana WebSocket methods such as `logsSubscribe`—costs 2 credits per 0.1 MB of uncompressed data. Standard subscriptions are available on all plans, and the Free plan allows five simultaneous WebSocket connections. The mainnet endpoint is the unified LaserStream WebSocket endpoint. Do not infer the precise credit consumption from local JSON payload counts: Helius is authoritative for its billing meter. Source: [Helius WebSockets FAQ](https://www.helius.dev/docs/faqs/websockets), [Helius credit schedule](https://www.helius.dev/docs/billing/credits), and [Helius WebSocket guide](https://www.helius.dev/docs/rpc/websocket).

Because the Pump.fun and PumpSwap program-wide log filters can return a high message volume, the application must be **off by default** and offer an explicit Start/Stop action with the credit rate displayed before activation. Keep one shared connection per server process, require an active same-origin viewer to start, and stop after a 5-second no-viewer grace period. A multi-instance deployment may open one connection per instance until shared coordination is implemented; the stream remains an optional, read-only monitor and should not be left running without an authorized viewer.
