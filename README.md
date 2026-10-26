# Cotra — Solana Intelligence & Copy Trading

React / Express / tRPC / Drizzle, adapted from the managed `web-db-user` template. The application calls provider APIs from the server; browser bundles do not contain RPC credentials.

## Current functional surface

- Mainnet-beta cluster identity is checked against Helius RPC's genesis hash before the data panel identifies the cluster as verified.
- Latest Solana token profiles/pairs and trending/new-pool observations are fetched from DEX Screener and GeckoTerminal. Responses are filtered to Solana. Market metrics carry source and fetch-time labels; unavailable values remain unavailable rather than being replaced by sample data.
- Token pages resolve DAS metadata plus finalized `getTokenSupply`/`getAccountInfo` fields, show provider-reported DEX pair metrics and pools, and plot only returned GeckoTerminal pool OHLCV. A SOL price is either the pair's SOL-native price or an identified calculation using the wrapped-SOL USD pair; the method is shown.
- Wallet addresses may be stored locally in this browser. Their transaction pages show a bounded set of finalized signatures and exact-string token deltas only for token accounts that RPC attributes to the requested address. Deltas are never called buys or sells.
- The copy-trading surface remains locked. No private keys, seed phrases, signed swap builders or mainnet transaction submissions are present.

This is the live-data foundation, not completion of the entire phased product brief. The public DEX/Onchain API polls and caches are not WebSocket transaction streaming or production data-delivery SLAs. PnL ranking, wallet clusters, risk certification, persistent account watchlists, delegated signing and live auto-execution remain open; see `TODO.md` and `plan.md`.

## Commands and project structure

- `pnpm dev`: start the Express/Vite dev server on `PORT` (default 3000).
- `pnpm build` / `pnpm start`: compile and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in Drizzle migrations. `pnpm db:push`: generate/apply a schema change; review migrations before running against the database shared by development and publication.
- `pnpm check`: TypeScript. `pnpm test`: Vitest.
- `client/src/pages/`: overview, token intelligence and wallet activity.
- `server/providers/solana.ts`: server-only Helius, DEX Screener and GeckoTerminal adapters, caching and mainnet verification.
- `server/routers.ts`: validated read-only market procedures.
- `docs/provider-research.md`: official provider sources, cached-data caveats and limits.

Required secret `HELIUS_API_KEY` is configured through the protected project secret input. Never check it into Git, print it to logs, or return it to a client. DEX Screener/GeckoTerminal public API throughput, beta status and caching are described in `docs/provider-research.md`. These sources do not constitute production feed SLAs. The app applies route-scoped request limits keyed by Express's request IP, a bounded in-memory cache, in-flight limits, and per-process upstream budgets (55 DEX Screener, 8 GeckoTerminal and 120 Helius requests per minute); these are abuse/quota guardrails for the current single-process slice, not distributed production rate limiting.

`client/public/manus-routes.json` is the route manifest. `client/public/cotra-mark.svg` is the Cotra favicon mark. `app.config.ts` contains the platform's literal HTTPS project-logo URL.

## Mainnet and source semantics

All Solana RPC/DAS requests use the fixed Helius mainnet endpoint and verify the Solana mainnet-beta genesis hash. No testnet or devnet is included. Helius DAS cached `price_info` is intentionally not used as a live market price. DEX Screener pair data is source-reported rather than recomputed. A field called market cap is not asserted as circulating market capitalization without reliable circulating supply. Liquidity rows refer to individual pools and are never naively summed across overlapping venues. External token links and metadata are unverified.

Historical OHLCV is returned directly from a current GeckoTerminal pool endpoint; unsupported time windows and empty history remain empty. Wallet transaction history is a limited recent finalized sample, not a complete PnL record. Token balance changes do not prove trade intent, ownership or common wallet identity.

## Security and operational gates

No sign/execute API is currently implemented. Never collect seed phrases or store plaintext private keys in SQL. Mainnet copy trading requires an explicitly authorized signing model with key isolation, revocation, server-enforced exposure/fees/slippage and loss bounds, quote freshness, idempotency, transaction finality tracking, retry discipline, audit trails, emergency stop and reconciliation against real chain balances. Do not show a trade as successful until on-chain transaction state has been reconciled. Health route: `/api/health`; process port: `PORT` (defaults to 3000). The protected Helius value is read at runtime and is not a frontend-safe public setting.
