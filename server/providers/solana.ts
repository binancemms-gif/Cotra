import { createHash } from "node:crypto";

export type SourceState = {
  source: string;
  status: "live" | "stale" | "unavailable";
  updatedAt: string | null;
  cacheTtlSeconds: number;
  detail: string;
};

type CacheEntry<T> = { value: T; fetchedAt: number };
const responseCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const upstreamWindows = new Map<string, number[]>();
const MAX_CACHE_ENTRIES = 2_000;
const MAX_IN_FLIGHT = 256;
const UPSTREAM_LIMITS_PER_MINUTE: Record<string, number> = { dex: 55, gecko: 8, helius: 120 };
const HELIUS_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const DEX_BASE = "https://api.dexscreener.com";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, BigInt(index)]));

export function isValidSolanaPublicKey(value: string): boolean {
  if (value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return false;
    decoded = decoded * 58n + digit;
  }
  const leadingZeroBytes = value.match(/^1*/)?.[0].length ?? 0;
  const decodedBytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(2).length / 8);
  return leadingZeroBytes + decodedBytes === 32;
}

function getHeliusKey() {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new ProviderError("Helius mainnet access is not configured.", "HELIUS_API_KEY");
  return key;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly provider: string, public readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

function upstreamBucket(provider: string): string | null {
  if (provider.startsWith("DEX Screener")) return "dex";
  if (provider.startsWith("GeckoTerminal")) return "gecko";
  if (provider.startsWith("Helius")) return "helius";
  return null;
}

function enforceUpstreamBudget(provider: string) {
  const bucket = upstreamBucket(provider);
  if (!bucket) return;
  const now = Date.now();
  const recent = (upstreamWindows.get(bucket) ?? []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= UPSTREAM_LIMITS_PER_MINUTE[bucket]) {
    throw new ProviderError(`Cotra's in-process ${bucket} provider budget is temporarily exhausted; retry after the current minute window.`, provider, 429);
  }
  recent.push(now);
  upstreamWindows.set(bucket, recent);
}

function storeResponse<T>(key: string, value: T, fetchedAt: number) {
  responseCache.delete(key);
  while (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
  responseCache.set(key, { value, fetchedAt });
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ data: T; fetchedAt: number }> {
  const now = Date.now();
  const hit = responseCache.get(key) as CacheEntry<T> | undefined;
  if (hit && now - hit.fetchedAt < ttlMs) {
    responseCache.delete(key);
    responseCache.set(key, hit);
    return { data: hit.value, fetchedAt: hit.fetchedAt };
  }
  if (hit) responseCache.delete(key);
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    const data = await existing;
    const entry = responseCache.get(key) as CacheEntry<T> | undefined;
    return { data, fetchedAt: entry?.fetchedAt ?? Date.now() };
  }
  if (inFlight.size >= MAX_IN_FLIGHT) throw new ProviderError("Cotra's in-process provider concurrency limit is temporarily full.", "Cotra data gateway", 429);
  const request = load();
  inFlight.set(key, request);
  try {
    const data = await request;
    const fetchedAt = Date.now();
    storeResponse(key, data, fetchedAt);
    return { data, fetchedAt };
  } finally {
    inFlight.delete(key);
  }
}

async function fetchJson<T>(url: string, provider: string, init?: RequestInit): Promise<T> {
  let lastMessage = "Request failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    enforceUpstreamBudget(provider);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { Accept: "application/json", ...init?.headers } });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        lastMessage = `${provider} returned HTTP ${response.status}`;
        if (retryable && attempt === 0) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter > 0 ? retryAfter * 1000 : 800, 4000)));
          continue;
        }
        throw new ProviderError(lastMessage, provider, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastMessage = error instanceof Error && error.name === "AbortError" ? `${provider} timed out` : `${provider} request failed`;
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }
      throw new ProviderError(lastMessage, provider);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ProviderError(lastMessage, provider);
}

export function rpc<T>(method: string, params: unknown[], ttlMs = 0) {
  const cacheKey = `helius:${method}:${createHash("sha256").update(JSON.stringify(params)).digest("hex")}`;
  const load = async () => {
    const url = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(getHeliusKey())}`;
    const result = await fetchJson<{ result?: T; error?: { message?: string } }>(url, "Helius Solana mainnet RPC", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "cotra", method, params }),
    });
    if (result.error) throw new ProviderError(result.error.message ?? "Helius RPC returned an error", "Helius Solana mainnet RPC");
    if (result.result === undefined) throw new ProviderError("Helius RPC returned no result", "Helius Solana mainnet RPC");
    return result.result;
  };
  return ttlMs > 0 ? cached(cacheKey, ttlMs, load) : load().then(data => ({ data, fetchedAt: Date.now() }));
}

export async function verifyHeliusMainnet() {
  const { data, fetchedAt } = await rpc<string>("getGenesisHash", [], 15_000);
  if (data !== HELIUS_MAINNET_GENESIS) {
    throw new ProviderError("RPC genesis hash does not match Solana mainnet-beta; refusing to report this source as mainnet.", "Helius Solana mainnet RPC");
  }
  return { verified: true as const, cluster: "mainnet-beta" as const, fetchedAt };
}

export type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: Array<{ url?: string }>; socials?: Array<{ platform?: string; handle?: string }> };
  baseTokenPrice?: string;
  quoteTokenPrice?: string;
};

export type GeckoResource = {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } }>;
};

export type TokenMarket = {
  mint: string;
  name: string | null;
  symbol: string | null;
  logo: string | null;
  priceUsd: number | null;
  priceSol: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  change24hPercent: number | null;
  poolCount: number;
  pools: Array<{ address: string; venue: string; quoteSymbol: string | null; priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; poolCreatedAt: string | null; source: string }>;
  source: string;
  updatedAt: string;
  freshness: "live" | "stale";
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function venueLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Unknown venue";
  const id = value.trim();
  const known: Record<string, string> = { raydium: "Raydium", orca: "Orca", meteora: "Meteora", "meteora-dbc": "Meteora DBC", "pump-fun": "Pump.fun", pumpswap: "PumpSwap", memefun: "Meme.fun" };
  return known[id.toLowerCase()] ?? id;
}

function latestPairsByMint(pairs: DexPair[]) {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    if (pair.chainId !== "solana" || !pair.baseToken?.address || !isValidSolanaPublicKey(pair.baseToken.address)) continue;
    const key = pair.baseToken.address;
    const current = best.get(key);
    if (!current || (pair.liquidity?.usd ?? 0) > (current.liquidity?.usd ?? 0)) best.set(key, pair);
  }
  return best;
}

export async function getMarketSnapshot() {
  const statuses: SourceState[] = [];
  const settled = await Promise.allSettled([
    cached("dex:profiles:latest", 30_000, () => fetchJson<unknown>(`${DEX_BASE}/token-profiles/latest/v1`, "DEX Screener")),
    cached("gecko:trending:solana", 60_000, () => fetchJson<{ data?: GeckoResource[]; included?: GeckoResource[] }>(`${GECKO_BASE}/networks/solana/trending_pools?page=1`, "GeckoTerminal", { headers: { Accept: "application/json;version=20230203" } })),
    verifyHeliusMainnet(),
    cached("gecko:new-pools:solana", 60_000, () => fetchJson<{ data?: GeckoResource[]; included?: GeckoResource[] }>(`${GECKO_BASE}/networks/solana/new_pools?page=1`, "GeckoTerminal", { headers: { Accept: "application/json;version=20230203" } })),
  ]);
  let profiles: Array<Record<string, unknown>> = [];
  let geckoPools: GeckoResource[] = [];
  let geckoIncluded: GeckoResource[] = [];
  let newPoolResources: GeckoResource[] = [];
  let newPoolIncluded: GeckoResource[] = [];
  if (settled[0].status === "fulfilled") {
    profiles = Array.isArray(settled[0].value.data) ? settled[0].value.data as Array<Record<string, unknown>> : [];
    statuses.push({ source: "DEX Screener profiles", status: "live", updatedAt: new Date(settled[0].value.fetchedAt).toISOString(), cacheTtlSeconds: 30, detail: "Latest source profiles; only Solana entries are retained." });
  } else statuses.push({ source: "DEX Screener profiles", status: "unavailable", updatedAt: null, cacheTtlSeconds: 30, detail: "Provider request failed; no profile rows are substituted." });
  if (settled[1].status === "fulfilled") {
    geckoPools = settled[1].value.data.data ?? [];
    geckoIncluded = settled[1].value.data.included ?? [];
    statuses.push({ source: "GeckoTerminal pools", status: "live", updatedAt: new Date(settled[1].value.fetchedAt).toISOString(), cacheTtlSeconds: 60, detail: "Solana trending pools; public API is cached for about one minute and limited to roughly 10 calls/minute." });
  } else statuses.push({ source: "GeckoTerminal pools", status: "unavailable", updatedAt: null, cacheTtlSeconds: 60, detail: "Provider request failed; pool data is unavailable." });
  let heliusMainnet: { verified: boolean; cluster: string; fetchedAt: number } | null = null;
  if (settled[2].status === "fulfilled") {
    heliusMainnet = settled[2].value;
    statuses.push({ source: "Helius Solana RPC", status: "live", updatedAt: new Date(heliusMainnet.fetchedAt).toISOString(), cacheTtlSeconds: 15, detail: "getGenesisHash matched the Solana mainnet-beta genesis hash." });
  } else statuses.push({ source: "Helius Solana RPC", status: "unavailable", updatedAt: null, cacheTtlSeconds: 15, detail: "Mainnet verification failed; no Helius-derived chain data is shown." });
  if (settled[3].status === "fulfilled") {
    newPoolResources = settled[3].value.data.data ?? [];
    newPoolIncluded = settled[3].value.data.included ?? [];
    statuses.push({ source: "GeckoTerminal new pools", status: "live", updatedAt: new Date(settled[3].value.fetchedAt).toISOString(), cacheTtlSeconds: 60, detail: "Recently created Solana pool records; pool creation is not the same as token mint creation." });
  } else statuses.push({ source: "GeckoTerminal new pools", status: "unavailable", updatedAt: null, cacheTtlSeconds: 60, detail: "Provider request failed; no launch/pool-age rows are substituted." });

  const solanaProfiles = profiles.filter(profile => profile.chainId === "solana" && typeof profile.tokenAddress === "string" && isValidSolanaPublicKey(profile.tokenAddress)).slice(0, 30);
  let dexPairs: DexPair[] = [];
  let dexPairFetchedAt: number | null = null;
  if (solanaProfiles.length > 0) {
    try {
      const addresses = solanaProfiles.map(profile => String(profile.tokenAddress)).join(",");
      const bulk = await cached(`dex:tokens:${createHash("sha1").update(addresses).digest("hex")}`, 30_000, () => fetchJson<DexPair[] | null>(`${DEX_BASE}/tokens/v1/solana/${encodeURIComponent(addresses)}`, "DEX Screener"));
      dexPairs = Array.isArray(bulk.data) ? bulk.data : [];
      dexPairFetchedAt = bulk.fetchedAt;
      statuses.push({ source: "DEX Screener Solana pairs", status: "live", updatedAt: new Date(bulk.fetchedAt).toISOString(), cacheTtlSeconds: 30, detail: "Bulk Solana token-pair query; source market fields are not independently verified." });
    } catch {
      statuses.push({ source: "DEX Screener Solana pairs", status: "unavailable", updatedAt: null, cacheTtlSeconds: 30, detail: "Bulk pair lookup failed; profile-only data is not displayed as a priced market." });
    }
  }
  const bestPairs = latestPairsByMint(dexPairs);
  const markets: TokenMarket[] = [];
  for (const profile of solanaProfiles) {
    const mint = String(profile.tokenAddress);
    const pair = bestPairs.get(mint);
    if (!pair) continue;
    const profileTimestamp = dexPairFetchedAt ?? Date.now();
    const volume = numberOrNull(pair.volume?.h24);
    markets.push({
      mint,
      name: pair.baseToken?.name ?? null,
      symbol: pair.baseToken?.symbol ?? null,
      logo: typeof profile.icon === "string" ? profile.icon : pair.info?.imageUrl ?? null,
      priceUsd: numberOrNull(pair.priceUsd),
      priceSol: pair.quoteToken?.address === WRAPPED_SOL_MINT ? numberOrNull(pair.priceNative) : null,
      marketCapUsd: numberOrNull(pair.marketCap),
      fdvUsd: numberOrNull(pair.fdv),
      liquidityUsd: numberOrNull(pair.liquidity?.usd),
      volume24hUsd: volume,
      buys24h: numberOrNull(pair.txns?.h24?.buys),
      sells24h: numberOrNull(pair.txns?.h24?.sells),
      change24hPercent: numberOrNull(pair.priceChange?.h24),
      poolCount: 1,
      pools: pair.pairAddress ? [{ address: pair.pairAddress, venue: pair.dexId ?? "Unknown venue", quoteSymbol: pair.quoteToken?.symbol ?? null, priceUsd: numberOrNull(pair.priceUsd), liquidityUsd: numberOrNull(pair.liquidity?.usd), volume24hUsd: volume, poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null, source: "DEX Screener" }] : [],
      source: "DEX Screener",
      updatedAt: new Date(profileTimestamp).toISOString(),
      freshness: "live",
    });
  }
  const pools = geckoPools.map(resource => {
    const attributes = resource.attributes ?? {};
    return {
      address: String(resource.id ?? "").replace(/^solana_/, ""),
      name: typeof attributes.name === "string" ? attributes.name : "Solana pool",
      venue: venueLabel(attributes.dex_name ?? resource.relationships?.dex?.data?.id),
      priceUsd: numberOrNull(attributes.base_token_price_usd),
      liquidityUsd: numberOrNull(attributes.reserve_in_usd),
      volume24hUsd: numberOrNull((attributes.volume_usd as Record<string, unknown> | undefined)?.h24),
      poolCreatedAt: typeof attributes.pool_created_at === "string" ? attributes.pool_created_at : null,
      baseMint: resource.relationships?.base_token?.data?.id?.replace(/^solana_/, "") ?? null,
      quoteMint: resource.relationships?.quote_token?.data?.id?.replace(/^solana_/, "") ?? null,
      source: "GeckoTerminal",
      updatedAt: statuses.find(item => item.source === "GeckoTerminal pools")?.updatedAt,
    };
  });
  const launches = geckoIncluded.filter(item => item.attributes && String(item.id).startsWith("solana_") && isValidSolanaPublicKey(String(item.id).replace(/^solana_/, ""))).slice(0, 8).map(item => ({
    mint: String(item.id).replace(/^solana_/, ""),
    name: String(item.attributes?.name ?? "Token metadata unavailable"),
    symbol: String(item.attributes?.symbol ?? "—"),
    logo: typeof item.attributes?.image_url === "string" ? item.attributes.image_url : null,
  }));
  const includedTokens = new Map(newPoolIncluded.map(item => [String(item.id), item]));
  const newPools = newPoolResources.map(resource => {
    const mintId = resource.relationships?.base_token?.data?.id;
    const token = mintId ? includedTokens.get(mintId) : undefined;
    const tokenMint = mintId?.replace(/^solana_/, "") ?? null;
    const tokenName = typeof token?.attributes?.name === "string" ? token.attributes.name : null;
    const tokenSymbol = typeof token?.attributes?.symbol === "string" ? token.attributes.symbol : null;
    const image = typeof token?.attributes?.image_url === "string" ? token.attributes.image_url : null;
    const attributes = resource.attributes ?? {};
    return {
      address: String(resource.id ?? "").replace(/^solana_/, ""),
      mint: tokenMint && isValidSolanaPublicKey(tokenMint) ? tokenMint : null,
      name: tokenName,
      symbol: tokenSymbol,
      logo: image,
      venue: venueLabel(attributes.dex_name ?? resource.relationships?.dex?.data?.id),
      pairName: typeof attributes.name === "string" ? attributes.name : null,
      createdAt: typeof attributes.pool_created_at === "string" ? attributes.pool_created_at : null,
      liquidityUsd: numberOrNull(attributes.reserve_in_usd),
      volume24hUsd: numberOrNull((attributes.volume_usd as Record<string, unknown> | undefined)?.h24),
      source: "GeckoTerminal",
    };
  });
  return {
    cluster: heliusMainnet ? "mainnet-beta" : null,
    mainnetVerified: Boolean(heliusMainnet),
    fetchedAt: new Date().toISOString(),
    tokens: markets.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)).slice(0, 20),
    pools: pools.slice(0, 12),
    newPools: newPools.slice(0, 12),
    launches,
    sources: statuses,
    warnings: [
      "DEX Screener pairs are source-reported market observations; they are not independently recomputed from reserves.",
      "GeckoTerminal's public API is beta, cached for about one minute, and limited to roughly 10 requests per minute. This view does not guarantee exchange-grade real-time delivery.",
      "Pool rows are individual pools; no cross-venue liquidity total is calculated, preventing duplicate liquidity aggregation.",
    ],
  };
}

export async function lookupToken(mint: string) {
  if (!isValidSolanaPublicKey(mint)) throw new ProviderError("Enter a base58 address that decodes to a 32-byte Solana public key.", "Input validation");
  const solPricePairsPromise = mint === WRAPPED_SOL_MINT ? Promise.resolve(null) : cached(`dex:pairs:${WRAPPED_SOL_MINT}`, 30_000, () => fetchJson<DexPair[] | null>(`${DEX_BASE}/token-pairs/v1/solana/${WRAPPED_SOL_MINT}`, "DEX Screener wrapped-SOL reference"));
  const [assetResult, pairResult, supplyResult, mintAccountResult, solPriceResult, mainnetResult] = await Promise.allSettled([
    cached(`helius:asset:${mint}`, 60_000, async () => {
      const url = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(getHeliusKey())}`;
      const body = await fetchJson<{ result?: unknown; error?: { message?: string } }>(url, "Helius DAS", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "cotra-asset", method: "getAsset", params: { id: mint, options: { showFungible: true } } }) });
      if (body.error) throw new ProviderError(body.error.message ?? "Helius DAS returned an error", "Helius DAS");
      return body.result ?? null;
    }),
    cached(`dex:pairs:${mint}`, 30_000, () => fetchJson<DexPair[] | null>(`${DEX_BASE}/token-pairs/v1/solana/${encodeURIComponent(mint)}`, "DEX Screener")),
    rpc<{ value?: { amount?: string; decimals?: number; uiAmountString?: string } | null }>("getTokenSupply", [mint, { commitment: "finalized" }], 60_000),
    rpc<{ value?: { owner?: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "finalized" }], 60_000),
    solPricePairsPromise,
    verifyHeliusMainnet(),
  ]);
  const mainnetVerified = mainnetResult.status === "fulfilled";
  const mintAccount = mainnetVerified && mintAccountResult.status === "fulfilled" ? mintAccountResult.value.data.value : null;
  const tokenProgram = mintAccount?.owner;
  const isSupportedMint = mainnetVerified && mintAccount?.data?.parsed?.type === "mint" && (tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" || tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const asset = mainnetVerified && assetResult.status === "fulfilled" ? assetResult.value.data as Record<string, unknown> | null : null;
  const pairs = pairResult.status === "fulfilled" && Array.isArray(pairResult.value.data) ? pairResult.value.data.filter(pair => pair.chainId === "solana" && pair.baseToken?.address === mint) : [];
  const sortedPairs = isSupportedMint ? [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)) : [];
  const best = sortedPairs[0];
  const solPairs = solPriceResult.status === "fulfilled" && solPriceResult.value && Array.isArray(solPriceResult.value.data) ? solPriceResult.value.data.filter(pair => pair.chainId === "solana" && pair.baseToken?.address === WRAPPED_SOL_MINT) : [];
  const solPair = [...solPairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const solPriceUsd = mint === WRAPPED_SOL_MINT ? null : numberOrNull(solPair?.priceUsd);
  const tokenInfo = asset?.token_info as Record<string, unknown> | undefined;
  const content = asset?.content as Record<string, unknown> | undefined;
  const metadata = content?.metadata as Record<string, unknown> | undefined;
  const links = content?.links as Record<string, unknown> | undefined;
  const creators = Array.isArray(asset?.creators) ? asset.creators.filter((creator): creator is Record<string, unknown> => typeof creator === "object" && creator !== null) : [];
  const creator = creators.find(item => item.verified === true && typeof item.address === "string") ?? creators.find(item => typeof item.address === "string");
  const supplyValue = isSupportedMint && supplyResult.status === "fulfilled" ? supplyResult.value.data.value : null;
  const mintInfo = mintAccount?.data?.parsed?.info;
  const supply = typeof supplyValue?.uiAmountString === "string" ? supplyValue.uiAmountString : null;
  const decimals = isSupportedMint ? numberOrNull(supplyValue?.decimals) ?? numberOrNull(tokenInfo?.decimals) : null;
  const price = numberOrNull(best?.priceUsd);
  const marketCap = numberOrNull(best?.marketCap);
  const fdv = numberOrNull(best?.fdv);
  const resultTimestamp = pairResult.status === "fulfilled" ? new Date(pairResult.value.fetchedAt).toISOString() : new Date().toISOString();
  const info = best?.info;
  const metadataStatus = asset ? (asset.mutable === false ? "Helius DAS reports metadata immutable; authenticity not implied" : "Helius DAS metadata returned; authenticity not implied") : "Metadata unavailable";
  return {
    mint,
    cluster: mainnetVerified ? "mainnet-beta" as const : null,
    mainnetVerified,
    metadata: {
      name: typeof metadata?.name === "string" ? metadata.name : best?.baseToken?.name ?? null,
      symbol: typeof metadata?.symbol === "string" ? metadata.symbol : best?.baseToken?.symbol ?? null,
      logo: typeof links?.image === "string" ? links.image : typeof info?.imageUrl === "string" ? info.imageUrl : null,
      metadataUri: typeof content?.json_uri === "string" ? content.json_uri : null,
      decimals,
      tokenStandard: typeof asset?.interface === "string" ? asset.interface : null,
      mintStatus: isSupportedMint ? "Finalized Helius RPC parsed this account as an SPL Token or Token-2022 mint." : "Not verified as a supported SPL Token or Token-2022 mint on finalized mainnet RPC.",
      totalSupply: supply,
      mintAuthority: isSupportedMint && typeof mintInfo?.mintAuthority === "string" ? mintInfo.mintAuthority : null,
      freezeAuthority: isSupportedMint && typeof mintInfo?.freezeAuthority === "string" ? mintInfo.freezeAuthority : null,
      updateAuthority: typeof metadata?.updateAuthority === "string" ? metadata.updateAuthority : null,
      creator: typeof creator?.address === "string" ? creator.address : null,
      creatorVerification: creator ? creator.verified === true ? "Helius DAS reports a verified creator entry; this does not establish identity or token safety." : "Creator address returned without a positive DAS verification flag." : "Creator address not returned.",
      tokenProgram: isSupportedMint && typeof tokenProgram === "string" ? tokenProgram : null,
      creationTime: null,
      verificationStatus: metadataStatus,
      website: Array.isArray(info?.websites) ? info.websites[0]?.url ?? null : null,
      socials: Array.isArray(info?.socials) ? info.socials.map(social => ({ platform: social.platform ?? "social", handle: social.handle ?? "" })) : [],
    },
    market: best ? {
      priceUsd: price,
      priceSol: mint === WRAPPED_SOL_MINT ? 1 : best.quoteToken?.address === WRAPPED_SOL_MINT && best.priceNative ? numberOrNull(best.priceNative) : price !== null && solPriceUsd !== null && solPriceUsd > 0 ? price / solPriceUsd : null,
      priceSolMethod: mint === WRAPPED_SOL_MINT ? "Wrapped-SOL mint unit: 1 SOL" : best.quoteToken?.address === WRAPPED_SOL_MINT && best.priceNative ? "Provider-reported pair native price; quote mint is the canonical wrapped-SOL address" : solPriceUsd !== null ? "Calculated from DEX Screener token USD price ÷ wrapped-SOL USD pair price" : "Unavailable: no valid wrapped-SOL reference price",
      marketCapUsd: marketCap,
      marketCapLabel: marketCap === null ? "Unavailable" : "Provider-reported market cap; circulating supply not independently verified",
      fdvUsd: fdv,
      liquidityUsd: numberOrNull(best.liquidity?.usd),
      volume24hUsd: numberOrNull(best.volume?.h24),
      buys24h: numberOrNull(best.txns?.h24?.buys),
      sells24h: numberOrNull(best.txns?.h24?.sells),
      change24hPercent: numberOrNull(best.priceChange?.h24),
      venue: best.dexId ?? null,
      poolAddress: best.pairAddress ?? null,
      poolCreatedAt: best.pairCreatedAt ? new Date(best.pairCreatedAt).toISOString() : null,
      source: "DEX Screener",
      updatedAt: resultTimestamp,
    } : null,
    pools: sortedPairs.map(pair => ({ address: pair.pairAddress ?? "", venue: pair.dexId ?? "Unknown", quoteSymbol: pair.quoteToken?.symbol ?? null, priceUsd: numberOrNull(pair.priceUsd), liquidityUsd: numberOrNull(pair.liquidity?.usd), volume24hUsd: numberOrNull(pair.volume?.h24), poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null, source: "DEX Screener" })),
    sources: [
      { source: "Helius DAS getAsset", status: asset ? "live" : "unavailable", updatedAt: assetResult.status === "fulfilled" ? new Date(assetResult.value.fetchedAt).toISOString() : null, cacheTtlSeconds: 60, detail: asset ? "Mint metadata where returned by DAS; cached DAS price fields are intentionally not used." : "Metadata lookup unavailable." },
      { source: "Helius getTokenSupply / getAccountInfo", status: isSupportedMint && supplyResult.status === "fulfilled" && supplyValue ? "live" : "unavailable", updatedAt: supplyResult.status === "fulfilled" ? new Date(supplyResult.value.fetchedAt).toISOString() : null, cacheTtlSeconds: 60, detail: isSupportedMint && supplyValue ? "Finalized mainnet RPC parsed this exact account as a supported token mint and returned supply/authority fields." : mainnetVerified ? "RPC did not confirm this exact address as a supported SPL Token/Token-2022 mint; mint-derived metrics are withheld." : "Mainnet genesis verification failed; Helius-derived chain fields are withheld." },
      { source: "DEX Screener token pairs", status: best ? "live" : pairResult.status === "fulfilled" ? "unavailable" : "unavailable", updatedAt: pairResult.status === "fulfilled" ? new Date(pairResult.value.fetchedAt).toISOString() : null, cacheTtlSeconds: 30, detail: best ? "Provider-reported Solana pair whose base-token mint exactly matches this address." : isSupportedMint ? "No exact base-mint Solana pair found or provider unavailable; market values remain unavailable." : "Market rows are suppressed until finalized RPC confirms this supported token mint." },
      { source: "DEX Screener wrapped-SOL reference", status: mint === WRAPPED_SOL_MINT ? best ? "live" : "unavailable" : solPair ? "live" : "unavailable", updatedAt: mint === WRAPPED_SOL_MINT && pairResult.status === "fulfilled" ? new Date(pairResult.value.fetchedAt).toISOString() : solPriceResult.status === "fulfilled" && solPriceResult.value ? new Date(solPriceResult.value.fetchedAt).toISOString() : null, cacheTtlSeconds: 30, detail: mint === WRAPPED_SOL_MINT ? "Wrapped SOL is denominated as one SOL." : solPair ? "Reference pair returned by DEX Screener; derived SOL prices show the USD-price division method." : "Reference pair unavailable; derived SOL price is not shown." },
    ],
    timestamp: resultTimestamp,
  };
}

export async function getCandles(mint: string, timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d") {
  if (!isValidSolanaPublicKey(mint)) throw new ProviderError("Enter a base58 address that decodes to a 32-byte Solana public key.", "Input validation");
  const pools = await cached(`gecko:token-pools:${mint}`, 60_000, () => fetchJson<{ data?: GeckoResource[] }>(`${GECKO_BASE}/networks/solana/tokens/${encodeURIComponent(mint)}/pools?page=1`, "GeckoTerminal", { headers: { Accept: "application/json;version=20230203" } }));
  const exactBaseMintPools = (pools.data.data ?? []).filter(item => item.relationships?.base_token?.data?.id === `solana_${mint}`);
  const pool = [...exactBaseMintPools].sort((a, b) => (numberOrNull(b.attributes?.reserve_in_usd) ?? 0) - (numberOrNull(a.attributes?.reserve_in_usd) ?? 0))[0];
  const poolAddress = String(pool?.id ?? "").replace(/^solana_/, "");
  if (!poolAddress) return { candles: [], poolAddress: null, source: "GeckoTerminal", updatedAt: new Date(pools.fetchedAt).toISOString(), status: "unavailable" as const, detail: "No pool with this exact base mint was returned; no candles were fabricated." };
  const timeframePart = timeframe.endsWith("m") ? "minute" : timeframe.endsWith("h") ? "hour" : "day";
  const aggregate = timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : timeframe === "4h" ? 4 : 1;
  const url = new URL(`${GECKO_BASE}/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframePart}`);
  url.searchParams.set("aggregate", String(aggregate));
  url.searchParams.set("limit", "200");
  url.searchParams.set("currency", "usd");
  const candleResult = await cached(`gecko:ohlcv:${poolAddress}:${timeframe}`, 60_000, () => fetchJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(url.toString(), "GeckoTerminal", { headers: { Accept: "application/json;version=20230203" } }));
  const rows = candleResult.data.data?.attributes?.ohlcv_list ?? [];
  const candles = rows.filter(row => {
    if (row.length < 6 || !row.every(Number.isFinite)) return false;
    const [time, open, high, low, close, volume] = row;
    return Number.isInteger(time) && time > 0 && open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0 && high >= open && high >= close && high >= low && low <= open && low <= close;
  }).sort((a, b) => a[0] - b[0]).map(row => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }));
  return {
    candles,
    poolAddress,
    source: "GeckoTerminal",
    updatedAt: new Date(candleResult.fetchedAt).toISOString(),
    status: candles.length ? "live" as const : "unavailable" as const,
    detail: "Pool OHLCV from GeckoTerminal API v2-beta; rows failing finite-value, positive-price, timestamp or OHLC invariants are omitted. Public API cache is approximately one minute.",
  };
}

export async function getWalletActivity(address: string) {
  if (!isValidSolanaPublicKey(address)) throw new ProviderError("Enter a base58 address that decodes to a 32-byte Solana public key.", "Input validation");
  const mainnet = await verifyHeliusMainnet();
  const { data: signatures } = await rpc<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown; confirmationStatus?: string }>>("getSignaturesForAddress", [address, { limit: 12, commitment: "finalized" }], 15_000);
  const transactions = await Promise.all(signatures.slice(0, 10).map(async signatureRecord => {
    try {
      const { data } = await rpc<Record<string, unknown> | null>("getTransaction", [signatureRecord.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }], 30_000);
      if (!data) return { signature: signatureRecord.signature, slot: signatureRecord.slot, timestamp: signatureRecord.blockTime ? new Date(signatureRecord.blockTime * 1000).toISOString() : null, commitment: signatureRecord.confirmationStatus ?? "finalized", status: signatureRecord.err ? "failed" : "finalized", eventType: "transaction", detail: "Transaction details were unavailable from RPC.", tokenChanges: [] };
      const meta = data.meta as Record<string, unknown> | null;
      const allPre = (meta?.preTokenBalances as Array<Record<string, unknown>> | undefined) ?? [];
      const allPost = (meta?.postTokenBalances as Array<Record<string, unknown>> | undefined) ?? [];
      const pre = allPre.filter(balance => balance.owner === address);
      const post = allPost.filter(balance => balance.owner === address);
      const accountKeys = new Set([...pre, ...post].map(balance => `${balance.accountIndex}:${String(balance.mint ?? "")}`));
      const changes = [...accountKeys].map(key => {
        const [accountIndex, mint] = key.split(":");
        if (!mint) return null;
        const beforeBalance = pre.find(balance => Number(balance.accountIndex) === Number(accountIndex) && balance.mint === mint);
        const afterBalance = post.find(balance => Number(balance.accountIndex) === Number(accountIndex) && balance.mint === mint);
        const beforeAmount = (beforeBalance?.uiTokenAmount as Record<string, unknown> | undefined)?.amount;
        const afterAmount = (afterBalance?.uiTokenAmount as Record<string, unknown> | undefined)?.amount;
        try {
          const before = BigInt(typeof beforeAmount === "string" ? beforeAmount : "0");
          const after = BigInt(typeof afterAmount === "string" ? afterAmount : "0");
          const delta = after - before;
          if (delta === 0n) return null;
          const decimals = Number((afterBalance?.uiTokenAmount as Record<string, unknown> | undefined)?.decimals ?? (beforeBalance?.uiTokenAmount as Record<string, unknown> | undefined)?.decimals ?? 0);
          const raw = (delta < 0n ? -delta : delta).toString().padStart(decimals + 1, "0");
          const amount = decimals > 0 ? `${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`.replace(/\.?0+$/, "") : raw;
          return { mint, amount, direction: delta > 0n ? "inflow" as const : "outflow" as const };
        } catch { return null; }
      }).filter((change): change is { mint: string; amount: string; direction: "inflow" | "outflow" } => Boolean(change));
      return {
        signature: signatureRecord.signature,
        slot: signatureRecord.slot,
        timestamp: signatureRecord.blockTime ? new Date(signatureRecord.blockTime * 1000).toISOString() : null,
        commitment: signatureRecord.confirmationStatus ?? "finalized",
        status: meta?.err || signatureRecord.err ? "failed" : "finalized",
        feeLamports: Number(meta?.fee ?? 0),
        eventType: "transaction",
        detail: "Raw finalized transaction with owner-matched token account deltas where the RPC identifies the owner. Deltas alone do not distinguish swap, transfer, liquidity action, or trade intent; no buy/sell label is inferred.",
        tokenChanges: changes,
      };
    } catch {
      return { signature: signatureRecord.signature, slot: signatureRecord.slot, timestamp: signatureRecord.blockTime ? new Date(signatureRecord.blockTime * 1000).toISOString() : null, commitment: signatureRecord.confirmationStatus ?? "finalized", status: "unavailable", eventType: "transaction", detail: "Transaction decoding unavailable; classification omitted.", tokenChanges: [] };
    }
  }));
  return { address, cluster: mainnet.cluster, mainnetVerified: mainnet.verified, commitment: "finalized", fetchedAt: new Date().toISOString(), source: "Helius Solana mainnet RPC", transactions };
}


export async function searchTokens(query: string) {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 80) throw new ProviderError("Search must be 2–80 characters.", "Input validation");
  const result = await cached(`dex:search:${normalized.toLowerCase()}`, 15_000, () => fetchJson<{ pairs?: DexPair[] | null }>(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(normalized)}`, "DEX Screener"));
  const pairs = Array.isArray(result.data.pairs) ? result.data.pairs.filter(pair => pair.chainId === "solana" && pair.baseToken?.address && isValidSolanaPublicKey(pair.baseToken.address)) : [];
  const best = latestPairsByMint(pairs);
  const tokens = [...best.entries()].map(([mint, pair]) => ({
    mint,
    name: pair.baseToken?.name ?? null,
    symbol: pair.baseToken?.symbol ?? null,
    logo: pair.info?.imageUrl ?? null,
    priceUsd: numberOrNull(pair.priceUsd),
    marketCapUsd: numberOrNull(pair.marketCap),
    fdvUsd: numberOrNull(pair.fdv),
    liquidityUsd: numberOrNull(pair.liquidity?.usd),
    volume24hUsd: numberOrNull(pair.volume?.h24),
    venue: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? null,
    source: "DEX Screener",
  }));
  return { tokens, source: "DEX Screener", updatedAt: new Date(result.fetchedAt).toISOString(), cluster: "Solana mainnet-beta" };
}


export type MarketSnapshot = Awaited<ReturnType<typeof getMarketSnapshot>>;
export type TokenDetail = Awaited<ReturnType<typeof lookupToken>>;
export type WalletActivity = Awaited<ReturnType<typeof getWalletActivity>>;
export type CandleResponse = Awaited<ReturnType<typeof getCandles>>;
