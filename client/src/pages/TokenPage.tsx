import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowUpRight, Copy, ExternalLink, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import type { TokenDetail } from "../../../server/providers/solana";

type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const frames: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
function currency(value: number | null | undefined, compact = false) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact && value > 999 ? "compact" : "standard", maximumFractionDigits: value < 0.001 ? 8 : value < 1 ? 5 : compact ? 2 : 4 }).format(value);
}
function short(address: string) { return address.length > 15 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address; }
function copy(text: string) { void navigator.clipboard?.writeText(text); }
function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined; }
  catch { return undefined; }
}

function CandleChart({ mint, timeframe }: { mint: string; timeframe: Timeframe }) {
  const query = trpc.market.candles.useQuery({ mint, timeframe }, { refetchInterval: 60_000, retry: false, staleTime: 45_000 });
  const candles = query.data?.candles ?? [];
  const geometry = useMemo(() => {
    if (!candles.length) return null;
    const W = 960, H = 330, left = 16, right = 84, top = 24, bottom = 54;
    const priceBottom = 246, usableW = W - left - right;
    const low = Math.min(...candles.map(candle => candle.low));
    const high = Math.max(...candles.map(candle => candle.high));
    const span = Math.max(high - low, Math.abs(high) * 0.0001, 1e-12);
    const maxVol = Math.max(...candles.map(candle => candle.volume), 0);
    const slot = usableW / candles.length;
    const bodyWidth = Math.max(2, Math.min(13, slot * 0.64));
    return { W, H, left, right, top, bottom, priceBottom, usableW, low, high, span, maxVol, slot, bodyWidth,
      x: (index: number) => left + index * slot + slot / 2,
      y: (price: number) => top + ((high - price) / span) * (priceBottom - top),
      volumeY: (volume: number) => 314 - (volume / (maxVol || 1)) * 46,
    };
  }, [candles]);
  if (query.isLoading) return <div className="chart-state"><LoaderCircle className="spin" size={20} /> Loading source OHLCV…</div>;
  if (query.error && !candles.length) return <div className="chart-state chart-error"><ShieldAlert size={18} /><div><strong>Historical candles unavailable</strong><span>{query.error.message}; no synthetic price series is displayed.</span></div><button onClick={() => query.refetch()}><RefreshCw size={14} /> Retry</button></div>;
  if (!candles.length || !geometry) return <div className="chart-state"><div><strong>No pool OHLCV returned</strong><span>This mint has no supported pool candle history for {timeframe}. No missing candles are interpolated.</span></div></div>;
  const g = geometry;
  const steps = 4;
  return <div className="candle-chart-wrap"><div className="candle-chart-scroll"><svg className="candle-chart" viewBox={`0 0 ${g.W} ${g.H}`} role="img" aria-label={`${candles.length} real ${timeframe} candles from GeckoTerminal`}>
    {Array.from({ length: steps + 1 }, (_, index) => { const value = g.high - g.span * index / steps; const y = g.y(value); return <g key={index}><line x1={g.left} x2={g.W - g.right + 5} y1={y} y2={y} className="chart-grid-line" /><text x={g.W - g.right + 12} y={y + 4} className="chart-axis-label">{currency(value)}</text></g>; })}
    {candles.map((candle, index) => { const x = g.x(index); const up = candle.close >= candle.open; const top = g.y(Math.max(candle.open, candle.close)); const height = Math.max(1.5, Math.abs(g.y(candle.open) - g.y(candle.close))); const vY = g.volumeY(candle.volume); return <g key={`${candle.time}-${index}`} className={up ? "chart-candle-up" : "chart-candle-down"}><line x1={x} x2={x} y1={g.y(candle.high)} y2={g.y(candle.low)} stroke="currentColor" strokeWidth="1.3" opacity=".8"/><rect x={x - g.bodyWidth / 2} y={top} width={g.bodyWidth} height={height} rx=".7" fill="currentColor"/><rect x={x - g.bodyWidth / 2} y={vY} width={g.bodyWidth} height={314 - vY} rx=".7" fill="currentColor" opacity=".23"/></g>; })}
    <text x={g.left} y="318" className="chart-axis-label">{new Date(candles[0].time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text><text x={g.W - g.right - 18} y="318" className="chart-axis-label" textAnchor="end">{new Date(candles.at(-1)!.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text>
    <text x={g.left} y="286" className="chart-volume-label">VOLUME · SOURCE OHLCV</text>
  </svg></div>{query.error && <div className="chart-stale-note">Refresh failed; showing the last OHLCV response retained in this page's memory. {query.error.message}</div>}<div className="chart-source-caption"><span><i className="chart-legend-up" /> Up <i className="chart-legend-down" /> Down</span><span>{candles.length} returned candles · {query.error ? "STALE · " : "Fetched · "}GeckoTerminal · {query.data?.updatedAt ? new Date(query.data.updatedAt).toLocaleTimeString() : ""}</span></div></div>;
}

export default function TokenPage() {
  const { mint = "" } = useParams<{ mint: string }>();
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [copied, setCopied] = useState(false);
  const token = trpc.market.token.useQuery({ mint }, { enabled: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint), retry: false });
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(timer); } }, [copied]);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return <main className="detail-page"><div className="detail-state"><ShieldAlert size={23} /><strong>Invalid Solana mint address</strong><span>Paste a valid base58 token mint to resolve its on-chain metadata and market pairs.</span><Link href="/" className="button-primary"><ArrowLeft size={15} /> Back to market</Link></div></main>;
  const data = token.data as TokenDetail | undefined;
  const chainStatus = token.error ? data ? "stale" : "unavailable" : token.isLoading ? "unavailable" : data?.mainnetVerified ? "live" : "unavailable";
  const isConfirmedMint = data?.metadata.mintStatus.startsWith("Finalized Helius RPC parsed") ?? false;
  const safeLogo = safeExternalUrl(data?.metadata.logo);
  const safeWebsite = safeExternalUrl(data?.metadata.website);
  return <main className="detail-page"><div className="detail-topbar"><Link href="/" className="back-link"><ArrowLeft size={16} /> Market overview</Link><span className="network-pill"><span className={`source-dot source-${chainStatus}`} />SOLANA MAINNET-BETA</span></div>
    {token.isLoading && <div className="detail-state"><LoaderCircle size={22} className="spin" /><strong>Resolving this mint from mainnet sources</strong><span>Fetching verified chain metadata and current Solana token-pair observations.</span></div>}
    {token.error && !data && <div className="detail-state detail-error"><ShieldAlert size={23} /><strong>Token data unavailable</strong><span>{token.error.message}</span><button className="button-quiet" onClick={() => token.refetch()}><RefreshCw size={14} /> Retry</button></div>}
    {token.error && data && <div className="provider-error-banner"><ShieldAlert size={17} /><div><strong>Previously returned token data · STALE</strong><span>Refresh failed. Last successful response retained in this browser's query cache: {new Date(data.timestamp).toLocaleString()}. Current provider values are not asserted to be live.</span></div><button onClick={() => token.refetch()}>Retry</button></div>}
    {data && <>
      <div className="detail-hero"><div className="detail-coin">{safeLogo && <img src={safeLogo} alt="" onError={event => { event.currentTarget.style.display = "none"; }} />}{!safeLogo && <span>{(data.metadata.symbol ?? "?").slice(0, 1)}</span>}</div><div className="detail-identity"><div className="eyebrow">TOKEN INTELLIGENCE · SOLANA</div><h1>{data.metadata.name ?? "Unknown token"} <span>{data.metadata.symbol ?? "—"}</span></h1><div className="mint-line"><span className="mono">{mint}</span><button className="icon-button" onClick={() => { copy(mint); setCopied(true); }} aria-label="Copy mint address">{copied ? <CheckIcon /> : <Copy size={14} />}</button><a href={`https://solscan.io/token/${encodeURIComponent(mint)}`} target="_blank" rel="noreferrer" aria-label="View on Solscan"><ExternalLink size={14} /></a></div></div><div className="detail-price"><strong>{data.market ? currency(data.market.priceUsd) : "Unavailable"}</strong><span>{data.market?.priceSol == null ? "SOL quote unavailable" : `${data.market.priceSol} SOL`}</span>{data.market?.priceSolMethod && <small className="detail-price-method">{data.market.priceSolMethod}</small>}</div></div>
      {!isConfirmedMint && <div className="provider-error-banner"><ShieldAlert size={17} /><div><strong>Mint not verified on finalized mainnet RPC</strong><span>Market rows are suppressed until this address is confirmed as an SPL Token or Token-2022 mint.</span></div></div>}
      {isConfirmedMint && !data.market && <div className="provider-error-banner"><ShieldAlert size={17} /><div><strong>No exact-mint Solana pair observation found</strong><span>Mint metadata may still be available, but price, volume, market cap and liquidity remain unavailable.</span></div></div>}
      <div className="detail-stats-grid"><div className="detail-stat"><span>MARKET CAP</span><strong>{currency(data.market?.marketCapUsd, true)}</strong><small>{data.market?.marketCapLabel ?? "Provider value unavailable"}</small></div><div className="detail-stat"><span>FDV</span><strong>{currency(data.market?.fdvUsd, true)}</strong><small>DEX Screener · source reported</small></div><div className="detail-stat"><span>POOL LIQUIDITY</span><strong>{currency(data.market?.liquidityUsd, true)}</strong><small>Best-liquidity returned pair</small></div><div className="detail-stat"><span>VOLUME · 24H</span><strong>{currency(data.market?.volume24hUsd, true)}</strong><small>DEX Screener · source reported</small></div><div className="detail-stat"><span>BUYS / SELLS · 24H</span><strong>{data.market ? `${data.market.buys24h ?? "—"} / ${data.market.sells24h ?? "—"}` : "Unavailable"}</strong><small>Pair-level transaction counts</small></div><div className="detail-stat"><span>PRICE CHANGE · 24H</span><strong className={(data.market?.change24hPercent ?? 0) >= 0 ? "positive" : "negative"}>{data.market?.change24hPercent == null ? "Unavailable" : `${data.market.change24hPercent > 0 ? "+" : ""}${data.market.change24hPercent.toFixed(2)}%`}</strong><small>Pair-level · DEX Screener</small></div></div>
      <section className="panel detail-chart-panel"><div className="panel-heading"><div><div className="eyebrow">HISTORICAL POOL DATA</div><h2>Price chart <span className="chart-data-tag"><i /> OHLCV</span></h2></div><div className="timeframe-control" role="group" aria-label="Chart interval">{frames.map(frame => <button key={frame} className={frame === timeframe ? "timeframe-active" : ""} onClick={() => setTimeframe(frame)}>{frame}</button>)}</div></div><CandleChart mint={mint} timeframe={timeframe} /><div className="chart-disclosure"><ShieldAlert size={14} /> Candles come from the best-liquidity pool selected by GeckoTerminal. The public API is beta and cached; gaps or unsupported intervals are not filled.</div></section>
      <div className="detail-lower-grid"><section className="panel metadata-panel"><div className="panel-heading"><div><div className="eyebrow">ON-CHAIN ATTRIBUTES</div><h2>Mint metadata</h2></div><span className="unverified-chip"><ShieldAlert size={13} /> NOT A SAFETY CERTIFICATION</span></div><div className="metadata-list">{([ ["Mint address", mint], ["Mint verification", data.metadata.mintStatus], ["Token standard", data.metadata.tokenStandard ?? "Unavailable"], ["Token program", data.metadata.tokenProgram ?? "Unavailable"], ["Decimals", data.metadata.decimals ?? "Unavailable"], ["Total supply", data.metadata.totalSupply ?? "Unavailable"], ["Metadata URI", data.metadata.metadataUri ?? "Unavailable"], ["Mint authority", data.metadata.mintAuthority ?? "Unavailable or not returned"], ["Freeze authority", data.metadata.freezeAuthority ?? "Unavailable or not returned"], ["Update authority", data.metadata.updateAuthority ?? "Unavailable or not returned"], ["DAS creator", data.metadata.creator ?? "Unavailable or not returned"], ["Token creation time", data.metadata.creationTime ?? "Not verified"] ] as Array<[string, string | number]>).map(([label, value]) => <div className="metadata-row" key={label}><span>{label}</span><strong className={String(value).length > 40 ? "mono" : ""}>{value}</strong></div>)}</div><div className="metadata-disclaimer">{data.metadata.verificationStatus}. {data.metadata.creatorVerification} Metadata and social links can be misleading; presence is not proof of authenticity.</div></section>
        <section className="panel pools-detail-panel"><div className="panel-heading"><div><div className="eyebrow">DEX SCREENER · SOLANA</div><h2>Matching pools <span className="table-count">{data.pools.length}</span></h2></div></div>{data.pools.length ? <div className="detail-pools-list">{data.pools.slice(0, 8).map((pool, index) => <div key={`${pool.address}-${index}`} className="detail-pool-row"><div><strong>{pool.venue}</strong><small className="mono">{pool.address ? short(pool.address) : "No address returned"}</small></div><div><strong>{currency(pool.liquidityUsd, true)}</strong><small>Pool liquidity</small></div><div><strong>{currency(pool.volume24hUsd, true)}</strong><small>24h volume</small></div>{pool.address && <a href={`https://dexscreener.com/solana/${encodeURIComponent(pool.address)}`} target="_blank" rel="noreferrer" aria-label="Open pool on DEX Screener"><ExternalLink size={14} /></a>}</div>)}</div> : <div className="small-empty">No current matching Solana pools returned.</div>}<div className="panel-footnote">Pool values are source-reported. Liquidity is not assumed locked or withdrawable.</div></section></div>
      <section className="panel detail-social-panel"><div className="panel-heading"><div><div className="eyebrow">EXTERNAL REFERENCES</div><h2>Project links</h2></div><span className="unverified-chip">UNVERIFIED BY COTRA</span></div><div className="social-links">{safeWebsite && <a href={safeWebsite} target="_blank" rel="noreferrer">Website <ExternalLink size={13} /></a>}{data.metadata.website && !safeWebsite && <span className="social-unverified">Website link withheld (unsupported URL scheme).</span>}{data.metadata.socials.map((social, index) => { const href = safeExternalUrl(social.handle); return <span className="social-unverified" key={`${social.platform}-${index}`}>{social.platform}: {href ? <a href={href} target="_blank" rel="noreferrer">{social.handle}<ExternalLink size={13} /></a> : social.handle || "unavailable"}</span>; })}{!data.metadata.website && !data.metadata.socials.length && <span className="empty-social">No website or social links returned by current market metadata.</span>}</div></section>
      <div className="token-data-footer"><span>Metadata: Helius DAS · Market and pairs: DEX Screener</span><span>Fetched {new Date(data.timestamp).toLocaleString()}</span><a href={`https://solscan.io/token/${encodeURIComponent(mint)}`} target="_blank" rel="noreferrer">Open mint on Solscan <ArrowUpRight size={14} /></a></div>
    </>}
  </main>;
}

function CheckIcon() { return <span aria-hidden="true" className="check-mark">✓</span>; }
