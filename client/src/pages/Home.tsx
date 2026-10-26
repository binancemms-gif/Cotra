import { trpc } from "@/lib/trpc";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp,
  Copy, ExternalLink, Eye, Gauge, Menu, RefreshCw, Search, ShieldAlert, Wallet,
  Waves, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import type { MarketSnapshot, TokenMarket } from "../../../server/providers/solana";

type SavedWallet = { address: string; label: string };
const WATCH_KEY = "cotra-followed-wallets";
const INITIAL_WALLET: SavedWallet[] = [];

function readWallets(): SavedWallet[] {
  try {
    const data = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
    return Array.isArray(data) ? data.filter(item => typeof item?.address === "string" && typeof item?.label === "string") : [];
  } catch { return INITIAL_WALLET; }
}

function shorten(value: string, prefix = 5, suffix = 5) {
  return value.length > prefix + suffix + 3 ? `${value.slice(0, prefix)}…${value.slice(-suffix)}` : value;
}

function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
}

function money(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.0001) return `$${value.toExponential(2)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function compact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function CoinMark({ src, symbol }: { src: string | null; symbol: string | null }) {
  const [failed, setFailed] = useState(false);
  const safeSrc = safeExternalUrl(src);
  if (safeSrc && !failed) return <img className="coin-mark" src={safeSrc} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span className="coin-mark coin-fallback">{(symbol || "?").slice(0, 1)}</span>;
}

function SourceStatus({ status }: { status: "live" | "stale" | "unavailable" }) {
  return <span className={`source-dot source-${status}`} aria-label={`Source ${status}`} />;
}

function Header({ search, setSearch, chainStatus }: { search: string; setSearch: (value: string) => void; chainStatus: "live" | "stale" | "unavailable" }) {
  const [open, setOpen] = useState(false);
  const [route, navigate] = useLocation();
  const clean = search.trim();
  const query = trpc.market.search.useQuery({ query: clean }, { enabled: clean.length >= 2 && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean), staleTime: 15_000, retry: false });
  const results = query.data?.tokens.slice(0, 5) ?? [];
  const isMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  const go = () => {
    if (isMint) { navigate(`/token/${clean}`); setOpen(false); return; }
    if (results[0]) { navigate(`/token/${results[0].mint}`); setOpen(false); }
  };
  useEffect(() => { setOpen(clean.length >= 2); }, [clean]);
  return <header className="topbar">
    <div className="mobile-brand"><CotraMark /><span>Cotra</span></div>
    <div className="global-search-wrap">
      <Search size={17} aria-hidden="true" />
      <input value={search} onChange={event => setSearch(event.target.value)} onFocus={() => clean.length >= 2 && setOpen(true)} onKeyDown={event => { if (event.key === "Enter") go(); if (event.key === "Escape") setOpen(false); }} placeholder="Search Solana tokens or paste a mint address" aria-label="Search tokens by name, symbol, or mint address" />
      {search && <button className="icon-button search-clear" onClick={() => { setSearch(""); setOpen(false); }} aria-label="Clear search"><X size={15} /></button>}
      {open && clean.length >= 2 && <div className="search-popover">
        {isMint ? <button className="search-result" onClick={go}><span className="search-result-icon"><Search size={16} /></span><span><strong>Open mint address</strong><small className="mono">{shorten(clean, 12, 12)}</small></span><ChevronDown size={15} /></button> : query.isLoading ? <div className="search-empty">Searching live Solana pairs…</div> : query.isError ? <div className="search-empty">Latest market search failed; no prior results are presented as current.</div> : results.length ? results.map(token => <button key={token.mint} className="search-result" onClick={() => { navigate(`/token/${token.mint}`); setOpen(false); }}><CoinMark src={token.logo} symbol={token.symbol} /><span><strong>{token.name ?? token.symbol ?? "Unknown token"}</strong><small>{token.symbol ?? "—"} · {shorten(token.mint)}</small></span><span className="search-result-price">{money(token.priceUsd, 6)}</span></button>) : <div className="search-empty">No indexed Solana pairs returned for this query.</div>}
        <div className="search-source">Search powered by DEX Screener · Solana pairs only</div>
      </div>}
    </div>
    <div className="topbar-actions">
      <span className="network-pill"><SourceStatus status={chainStatus} />SOLANA MAINNET</span>
      <button className="icon-button" aria-label="Alerts" title="Alerts are not yet configured"><Bell size={17} /><span className="notification-mark" /></button>
      <button className="avatar-button" aria-label="Open account"><span>C</span></button>
    </div>
    {route !== "/" && <Link className="sr-only" href="/">Go to overview</Link>}
  </header>;
}

function CotraMark() {
  return <svg className="cotra-mark" viewBox="0 0 36 36" aria-hidden="true"><path d="M27.7 10.4a12.2 12.2 0 1 0 0 15.2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><circle cx="27.2" cy="10.1" r="3.5" fill="currentColor"/><circle cx="27.2" cy="25.9" r="3.5" fill="currentColor"/><path d="M16.5 18h10.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".52"/></svg>;
}

const navGroups = [
  { heading: "MARKET", items: [{ id: "overview", label: "Overview", icon: Gauge }, { id: "tokens", label: "Token explorer", icon: Search }, { id: "liquidity", label: "Liquidity pools", icon: Waves }] },
  { heading: "INTELLIGENCE", items: [{ id: "wallets", label: "Wallet explorer", icon: Wallet }, { id: "smart", label: "Smart money", icon: Eye }, { id: "clusters", label: "Wallet clusters", icon: Activity }] },
  { heading: "EXECUTION", items: [{ id: "copy", label: "Copy trading", icon: Copy }, { id: "positions", label: "Positions", icon: ArrowUpRight }, { id: "risk", label: "Risk monitor", icon: ShieldAlert }] },
];

function Sidebar({ selected, onSelect, walletCount, chainStatus }: { selected: string; onSelect: (id: string) => void; walletCount: number; chainStatus: "live" | "stale" | "unavailable" }) {
  return <aside className="sidebar">
    <Link href="/" className="brand-lockup"><CotraMark /><span className="brand-name">cotra<span className="brand-period">.</span><small>ON-CHAIN INTELLIGENCE</small></span></Link>
    <div className="sidebar-network"><span className="sidebar-network-line"><SourceStatus status={chainStatus} /> MAINNET-BETA</span><span className="sidebar-rpc-state">RPC genesis verification status is shown in the data sources panel</span></div>
    <nav aria-label="Main navigation" className="side-nav">{navGroups.map(group => <section key={group.heading} className="nav-group"><h2>{group.heading}</h2>{group.items.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${selected === item.id ? "nav-active" : ""}`} onClick={() => onSelect(item.id)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "wallets" && walletCount > 0 && <em>{walletCount}</em>}</button>; })}</section>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-callout"><span className="callout-icon"><ShieldAlert size={15} /></span><div><strong>Trade execution locked</strong><small>Secure signer not configured</small></div></div><div className="sidebar-footer"><span className="sidebar-footer-mark"><CotraMark /></span><span>Market intelligence, with receipts.</span></div></div>
  </aside>;
}

function MetricCard({ title, value, detail, icon: Icon, tone = "teal", link }: { title: string; value: string; detail: string; icon: typeof Activity; tone?: string; link?: string }) {
  const content = <div className="metric-card"><div className="metric-top"><span className="metric-label">{title}</span><span className={`metric-icon metric-icon-${tone}`}><Icon size={17} /></span></div><strong className="metric-value">{value}</strong><div className="metric-detail"><span>{detail}</span>{link && <ExternalLink size={12} />}</div></div>;
  return link ? <a href={link} target="_blank" rel="noreferrer" className="metric-link">{content}</a> : content;
}

function TokenTable({ tokens, loading, error }: { tokens: TokenMarket[]; loading: boolean; error: boolean }) {
  if (loading) return <div className="table-empty"><RefreshCw size={16} className="spin" /> Loading current Solana pair observations…</div>;
  if (error) return <div className="table-empty empty-error"><CircleHelp size={17} /> The market provider did not return data. No fallback rows are displayed.</div>;
  if (!tokens.length) return <div className="table-empty"><Search size={16} /> No indexed Solana profiles currently have a matching pair observation.</div>;
  return <div className="table-scroll"><table className="market-table"><thead><tr><th>ASSET</th><th>PRICE</th><th>24H CHANGE</th><th>LIQUIDITY</th><th>VOLUME · 24H</th><th>BUYS / SELLS</th><th>VENUE</th><th aria-label="Open token details" /></tr></thead><tbody>{tokens.map((token, index) => <tr key={`${token.mint}-${index}`}><td><Link href={`/token/${token.mint}`} className="asset-cell"><CoinMark src={token.logo} symbol={token.symbol} /><span className="asset-text"><strong>{token.name || token.symbol || "Unnamed token"}</strong><small><span>{token.symbol || "—"}</span><span className="asset-mint">{shorten(token.mint)}</span></small></span></Link></td><td className="table-price">{money(token.priceUsd, token.priceUsd !== null && token.priceUsd < 0.01 ? 7 : 4)}<small>DEX Screener</small></td><td><span className={`change-value ${(token.change24hPercent ?? 0) > 0 ? "positive" : (token.change24hPercent ?? 0) < 0 ? "negative" : "neutral"}`}>{token.change24hPercent === null ? "—" : <>{token.change24hPercent > 0 ? <ArrowUpRight size={13} /> : token.change24hPercent < 0 ? <ArrowDownRight size={13} /> : null}{Math.abs(token.change24hPercent).toFixed(2)}%</>}</span></td><td>{money(token.liquidityUsd, 0)}</td><td>{money(token.volume24hUsd, 0)}</td><td className="txn-cell"><span className="positive">{compact(token.buys24h)}</span><span className="txn-divider">/</span><span className="negative">{compact(token.sells24h)}</span></td><td><span className="venue-tag">{token.pools[0]?.venue ?? "—"}</span></td><td><Link href={`/token/${token.mint}`} className="table-open" aria-label={`View ${token.symbol ?? "token"}`}><ExternalLink size={14} /></Link></td></tr>)}</tbody></table></div>;
}

function SourcePanel({ sources, warnings }: { sources: MarketSnapshot["sources"]; warnings: MarketSnapshot["warnings"] }) {
  return <section className="panel source-panel"><div className="panel-heading"><div><div className="eyebrow">OBSERVABILITY</div><h2>Data sources</h2></div><span className="subtle-label">STATUS · LAST FETCH</span></div><div className="source-list">{sources.map(source => <div className="source-row" key={source.source}><span className="source-row-indicator"><SourceStatus status={source.status} /></span><div className="source-row-main"><strong>{source.source}</strong><span>{source.detail}</span></div><div className="source-row-time">{source.updatedAt ? new Date(source.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</div></div>)}</div><div className="source-notice"><CircleHelp size={15} /><span>{warnings[0]}</span></div></section>;
}

function NewPoolsPanel({ pools, loading, stale }: { pools: MarketSnapshot["newPools"]; loading: boolean; stale: boolean }) {
  return <section className="panel new-pools-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT SOLANA POOL CREATION</div><h2>New pools <span className="table-count">{pools.length}</span></h2></div><span className="source-mini"><SourceStatus status={stale ? "stale" : loading ? "stale" : pools.length ? "live" : "unavailable"} /> GECKOTERMINAL</span></div>{loading ? <div className="small-empty">Loading pool creation records…</div> : !pools.length ? <div className="small-empty">No new pool records returned. This feed does not imply token creation time.</div> : <div className="new-pool-list">{pools.slice(0, 7).map((pool, index) => <div className="new-pool-row" key={`${pool.address}-${index}`}><CoinMark src={pool.logo} symbol={pool.symbol} /><div className="new-pool-identity">{pool.mint ? <Link href={`/token/${pool.mint}`}><strong>{pool.name || pool.symbol || "Token metadata unavailable"}</strong></Link> : <strong>{pool.name || pool.symbol || "Token metadata unavailable"}</strong>}<span>{pool.pairName || "Pair name unavailable"} · {pool.venue}</span><span>Mint {pool.mint ? shorten(pool.mint) : "unavailable"} · Pool {shorten(pool.address)}</span></div><div className="new-pool-metric"><strong>{money(pool.liquidityUsd, 0)}</strong><span>pool liquidity</span></div><div className="new-pool-age"><strong>{pool.createdAt ? new Date(pool.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Unavailable"}</strong><span>pool created</span></div></div>)}</div>}<div className="panel-footnote">GeckoTerminal new-pool records. A pool's creation time is not a verified token mint/launch timestamp.</div></section>;
}

function PoolList({ pools, loading, stale }: { pools: MarketSnapshot["pools"]; loading: boolean; stale: boolean }) {
  return <section className="panel pool-panel"><div className="panel-heading"><div><div className="eyebrow">ON-CHAIN VENUES</div><h2>Solana pools</h2></div><span className="source-mini"><SourceStatus status={stale ? "stale" : loading ? "stale" : pools.length ? "live" : "unavailable"} /> {stale ? "STALE" : "GECKOTERMINAL"}</span></div>{loading ? <div className="small-empty">Loading pool observations…</div> : !pools.length ? <div className="small-empty">Pool data unavailable. No liquidity estimates are fabricated.</div> : <div className="pool-list">{pools.slice(0, 6).map((pool, index) => <div className="pool-row" key={`${pool.address}-${index}`}><div className="pool-icon"><Waves size={15} /></div><div className="pool-info"><strong>{pool.name}</strong><span>{pool.venue} · {pool.address ? shorten(pool.address, 4, 4) : "pool address unavailable"}</span></div><div className="pool-stat"><strong>{money(pool.liquidityUsd, 0)}</strong><span>pool liquidity · source-reported</span></div><div className="pool-stat pool-volume"><strong>{money(pool.volume24hUsd, 0)}</strong><span>volume · 24h</span></div></div>)}</div>}<div className="panel-footnote">Pool observations are individual pools—not lending TVL, and not added into an aggregate.</div></section>;
}

function WalletWatch({ wallets, onAdd, onRemove }: { wallets: SavedWallet[]; onAdd: (wallet: SavedWallet) => void; onRemove: (address: string) => void }) {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const add = () => {
    const clean = address.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)) { setMessage("Enter a valid base58 Solana address."); return; }
    if (wallets.some(wallet => wallet.address === clean)) { setMessage("This wallet is already on this device’s list."); return; }
    onAdd({ address: clean, label: `Wallet ${wallets.length + 1}` });
    setAddress(""); setMessage("Saved in this browser only. No on-chain ownership is implied.");
  };
  return <section className="panel watch-panel"><div className="panel-heading"><div><div className="eyebrow">PERSONAL MONITORING</div><h2>Wallet watchlist</h2></div><span className="local-chip">THIS DEVICE</span></div><div className="watch-form"><div className="watch-input-wrap"><Wallet size={15} /><input value={address} onChange={event => { setAddress(event.target.value); setMessage(""); }} onKeyDown={event => event.key === "Enter" && add()} aria-label="Solana wallet address" placeholder="Paste a Solana wallet address" maxLength={44} /><button onClick={add} className="add-wallet-button">Follow wallet</button></div>{message && <span className={`form-message ${message.startsWith("Enter") ? "form-error" : ""}`}>{message}</span>}</div>{!wallets.length ? <div className="watch-empty"><div className="watch-empty-icon"><Eye size={17} /></div><div><strong>No followed wallets yet</strong><span>Add an address to open its finalized on-chain transaction view.</span></div></div> : <div className="watch-list">{wallets.map(wallet => <div key={wallet.address} className="watch-row"><span className="wallet-avatar">{wallet.label.slice(-1)}</span><Link href={`/wallet/${wallet.address}`} className="watch-wallet-address"><strong>{wallet.label}</strong><small className="mono">{shorten(wallet.address, 7, 7)}</small></Link><button className="remove-watch" onClick={() => onRemove(wallet.address)} aria-label={`Remove ${wallet.label}`}><X size={15} /></button></div>)}</div>}<div className="panel-footnote">Addresses are stored in browser local storage. A transfer or token balance change is not classified as a buy or sell without transaction evidence.</div></section>;
}

const moduleCopy: Record<string, { title: string; label: string; description: string; requirements: string }> = {
  wallets: { title: "Wallet explorer", label: "REAL FINALIZED WALLET ACTIVITY", description: "Add an address to your device-local watchlist and inspect its finalized mainnet signatures.", requirements: "The current activity view is a bounded recent sample. Token balance deltas are not classified as buys/sells, and there is no complete PnL or wallet-identity inference." },
  smart: { title: "Smart-money discovery", label: "PHASE 2 · WALLET INTELLIGENCE", description: "Cotra will only rank a wallet when observed trades, history coverage, costs, and methodology support it.", requirements: "Verified historical transaction coverage, auditable buy/sell classification, realized and unrealized PnL methodology, and confidence/sample-size reporting are not yet configured." },
  clusters: { title: "Wallet relationship graph", label: "PHASE 2 · ON-CHAIN EVIDENCE", description: "Relationships should expose their transaction evidence, not infer that two addresses belong to the same person.", requirements: "Funding, transfer, coordinated entry/exit and distribution evidence must be sourced and classified before the graph is enabled." },
  copy: { title: "Copy-trading controls", label: "PHASE 3 · EXECUTION LOCKED", description: "Real mainnet execution is deliberately unavailable until a secure, revocable signing model and explicit wallet authorization exist.", requirements: "No signer is configured. No seed phrase or private key is requested or stored. No transaction is being submitted. Trade sizing, exposure, slippage, fees, idempotency and emergency stops must be enforced server-side before activation." },
  positions: { title: "Positions and PnL", label: "PHASE 3 · RECONCILIATION REQUIRED", description: "Cotra does not claim positions or profits based on copied demo trades or estimated wallet balances.", requirements: "Connect an authorized user wallet, reconcile confirmed on-chain balance deltas, and account for transaction costs and incomplete history before rendering positions." },
  risk: { title: "Token risk monitor", label: "PHASE 2 · EVIDENCE-BASED CHECKS", description: "There is no safety guarantee. A token’s unknown or unavailable checks must remain visible.", requirements: "Mint/freeze authority, Token-2022 extensions, concentration, pool depth, liquidity changes, routes and missing-check evidence are not yet fully integrated." },
  liquidity: { title: "Liquidity intelligence", label: "REAL POOL OBSERVATIONS", description: "The pools below come from current provider responses; reserve estimates are not combined across venues.", requirements: "See individually sourced trending pools and their provider-reported liquidity below. Full pool-reserve decoding, venue coverage and withdrawal monitoring are future work." },
  tokens: { title: "Token explorer", label: "REAL SOLANA PAIRS", description: "Search by name/symbol, or paste a Solana mint to load provider-backed pair data and mint metadata.", requirements: "Every result is filtered to the Solana network and carries source and update information." },
};

export default function Home() {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wallets, setWallets] = useState<SavedWallet[]>(() => readWallets());
  const snapshot = trpc.market.snapshot.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true, retry: 1 });
  const rawData = snapshot.data as MarketSnapshot | undefined;
  const data: MarketSnapshot | undefined = rawData && snapshot.error ? { ...rawData, sources: rawData.sources.map(source => source.status === "live" ? { ...source, status: "stale" as const } : source) } : rawData;
  const chainStatus = snapshot.error ? rawData?.mainnetVerified ? "stale" as const : "unavailable" as const : data?.mainnetVerified ? "live" as const : "unavailable" as const;
  const marketStatus = snapshot.error ? rawData ? "stale" as const : "unavailable" as const : data?.sources.some(source => source.status === "live" && (source.source === "DEX Screener Solana pairs" || source.source === "GeckoTerminal pools")) ? "live" as const : "unavailable" as const;
  const tokens = useMemo(() => data?.tokens ?? [], [data?.tokens]);
  const selected = moduleCopy[section];
  useEffect(() => { try { localStorage.setItem(WATCH_KEY, JSON.stringify(wallets)); } catch { /* A private-mode quota/policy failure must not block read-only market use. */ } }, [wallets]);
  const followedWallets = wallets.length;
  return <div className="app-shell">
    <Sidebar selected={section} onSelect={id => { setSection(id); setMobileNavOpen(false); }} walletCount={followedWallets} chainStatus={chainStatus} />
    {mobileNavOpen && <button className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
    <div className="app-main"><Header search={search} setSearch={setSearch} chainStatus={chainStatus} />
      <main className="dashboard-content">
        <section className="page-heading"><div><div className="heading-overline"><span className={`live-indicator ${marketStatus === "stale" ? "market-stale" : marketStatus === "unavailable" ? "market-unavailable" : ""}`}><span /> {marketStatus === "live" ? "MARKET OBSERVATORY" : marketStatus === "stale" ? "STALE PROVIDER DATA" : snapshot.isLoading ? "LOADING MARKET DATA" : "DATA FEED UNAVAILABLE"}</span><span className="heading-slash">/</span><span>MAINNET-BETA</span></div><h1>{selected?.title ?? "Solana, without the noise."}</h1><p>{selected?.description ?? "Follow on-chain activity with source-level transparency. Real data only; unsupported metrics stay blank."}</p></div><div className="heading-actions"><span className="last-updated">{data?.fetchedAt ? `${snapshot.error ? "Last response" : "Fetched"} ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Awaiting provider data"}</span><button className="button-quiet" onClick={() => snapshot.refetch()} disabled={snapshot.isFetching}><RefreshCw size={14} className={snapshot.isFetching ? "spin" : ""} /> Refresh</button><button className="mobile-menu-button icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button></div></section>
        {selected && <div className="module-notice"><span className="module-notice-icon"><CircleHelp size={17} /></span><div><strong>{selected.label}</strong><span>{selected.requirements}</span></div></div>}
        {snapshot.error && !data && <div className="provider-error-banner"><ShieldAlert size={17} /><div><strong>Live market data is unavailable</strong><span>{snapshot.error.message}. Retry shortly; Cotra does not show cached sample metrics as live.</span></div><button onClick={() => snapshot.refetch()}>Retry</button></div>}
        <div className="metric-grid">
          <MetricCard title="Solana cluster" value={data?.mainnetVerified ? "Mainnet-beta" : "Unverified"} detail={data?.mainnetVerified ? "Genesis hash verified by Helius RPC" : "RPC verification required"} icon={Activity} tone={data?.mainnetVerified ? "teal" : "amber"} />
          <MetricCard title="Indexed token pairs" value={data?.tokens.length.toLocaleString() ?? "—"} detail="DEX Screener rows in this response" icon={Waves} />
          <MetricCard title="Wallets followed" value={String(followedWallets)} detail="Stored in this browser only" icon={Wallet} tone="violet" />
          <MetricCard title="Copy execution" value="Locked" detail="No signing provider authorized" icon={ShieldAlert} tone="amber" />
        </div>
        <section className="panel market-panel"><div className="panel-heading market-heading"><div><div className="eyebrow">SOLANA · SOURCE-ATTRIBUTED MARKET OBSERVATIONS</div><h2>Token pairs <span className="table-count">{data ? `${tokens.length} ${snapshot.error ? "last response" : "current"}` : "—"}</span></h2></div><div className="market-tools"><span className="feed-updated"><SourceStatus status={snapshot.error ? "stale" : data?.sources.some(source => source.status === "live" && source.source.startsWith("DEX Screener")) ? "live" : "unavailable"} /> Provider source <strong>DEX Screener</strong></span><button className="table-filter" onClick={() => setSearch("")}><span>Solana</span><ChevronDown size={14} /></button></div></div><TokenTable tokens={tokens} loading={snapshot.isLoading} error={Boolean(snapshot.error && !data)} /><div className="table-footer"><span>Price, volume, liquidity and 24h changes are provider-reported. Null fields are not estimated.</span><span>{snapshot.error ? "STALE · last fetch" : "DEX Screener · fetched"} {data?.sources.find(source => source.source === "DEX Screener Solana pairs")?.updatedAt ? new Date(data.sources.find(source => source.source === "DEX Screener Solana pairs")!.updatedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span></div></section>
        <div className="lower-grid"><NewPoolsPanel pools={data?.newPools ?? []} loading={snapshot.isLoading} stale={Boolean(snapshot.error)} /><WalletWatch wallets={wallets} onAdd={wallet => setWallets(current => [...current, wallet])} onRemove={address => setWallets(current => current.filter(wallet => wallet.address !== address))} /></div>
        <PoolList pools={data?.pools ?? []} loading={snapshot.isLoading} stale={Boolean(snapshot.error)} />
        <div className="lower-grid lower-secondary"><SourcePanel sources={data?.sources ?? [{ source: "Solana data providers", status: "unavailable" as const, updatedAt: null, cacheTtlSeconds: 0, detail: "Waiting for the first provider response." }]} warnings={data?.warnings ?? ["Market data has not yet been received from any configured provider."]} /><section className="panel risk-panel"><div className="panel-heading"><div><div className="eyebrow">EVIDENCE OVER ASSUMPTIONS</div><h2>Methodology notes</h2></div><ShieldAlert size={17} className="risk-title-icon" /></div><div className="risk-note"><span className="risk-note-mark">01</span><p><strong>No composite liquidity total.</strong> Pair liquidity is shown per provider-returned pool. Overlapping venue totals are not summed.</p></div><div className="risk-note"><span className="risk-note-mark">02</span><p><strong>No guessed wallet identity.</strong> Tracked addresses are treated independently unless on-chain evidence supports a stated relationship.</p></div><div className="risk-note"><span className="risk-note-mark">03</span><p><strong>No trade safety guarantee.</strong> A missing check is unknown, not a pass. Copy trading stays locked pending secured authorization.</p></div><Link href="/token/So11111111111111111111111111111111111111112" className="risk-link">View wrapped SOL market data <ExternalLink size={13} /></Link></section></div>
        <footer className="page-footer"><span><CotraMark /> COTRA <span className="footer-separator">·</span> SOLANA MAINNET</span><span>Financial observations are informational, source-attributed and may be delayed. Not investment advice.</span></footer>
      </main>
    </div>
  </div>;
}
