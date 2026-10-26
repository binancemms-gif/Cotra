import WebSocket, { type RawData } from "ws";
import { heliusMainnetWebSocketUrl, verifyHeliusMainnet } from "./solana";

export const PUMP_PROGRAMS = [
  { id: "pumpfun", name: "Pump.fun", address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" },
  { id: "pumpswap", name: "PumpSwap", address: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" },
] as const;

export type PumpInstruction = { side: "BUY" | "SELL"; instruction: string };
export type PumpTradeEvent = {
  id: string;
  signature: string;
  slot: number;
  program: string;
  programId: string;
  side: "BUY" | "SELL" | "MIXED";
  instructions: string[];
  commitment: "confirmed";
  observedAt: string;
  source: "Helius mainnet logsSubscribe";
};

export type PumpProgramStreamState = {
  id: string;
  name: string;
  address: string;
  subscription: "pending" | "live" | "unavailable";
};

export type PumpStreamStatus = {
  enabled: boolean;
  connectionState: "disabled" | "verifying-mainnet" | "connecting" | "subscribing" | "live" | "reconnecting" | "unavailable";
  cluster: "mainnet-beta" | null;
  mainnetVerified: boolean;
  protocol: "Solana logsSubscribe";
  commitment: "confirmed";
  connectedAt: string | null;
  lastMessageAt: string | null;
  lastPongAt: string | null;
  lastTradeAt: string | null;
  logsReceived: number;
  tradesReceived: number;
  failedProgramTransactions: number;
  reconnects: number;
  lastError: string | null;
  programs: PumpProgramStreamState[];
};

type NotificationValue = { signature?: unknown; err?: unknown; logs?: unknown };
type JsonRpcMessage = {
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown };
  method?: unknown;
  params?: { subscription?: unknown; result?: { context?: { slot?: unknown }; value?: NotificationValue } };
};
type StreamClient = { onTrade: (event: PumpTradeEvent) => void; onStatus: (status: PumpStreamStatus) => void };

const REQUEST_IDS = new Map<number, string>(PUMP_PROGRAMS.map((program, index) => [index + 1, program.id]));
const programsById = new Map<string, (typeof PUMP_PROGRAMS)[number]>(PUMP_PROGRAMS.map(program => [program.id, program]));
const programsByAddress = new Map<string, (typeof PUMP_PROGRAMS)[number]>(PUMP_PROGRAMS.map(program => [program.address, program]));
const subscriptionToProgram = new Map<number, string>();
const programStates = new Map<string, PumpProgramStreamState["subscription"]>(PUMP_PROGRAMS.map(program => [program.id, "pending"]));
const clients = new Set<StreamClient>();
const recentTrades: PumpTradeEvent[] = [];
const seenEventIds = new Map<string, number>();
const MAX_RECENT_TRADES = 100;
const MAX_SEEN_EVENTS = 4_000;
const WS_PING_MS = 30_000;
const MAX_RECONNECT_MS = 60_000;
const IDLE_STOP_MS = 5_000;

let started = false;
let socket: WebSocket | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let idleStopTimer: NodeJS.Timeout | null = null;
let retryAttempt = 0;
let reconnectCount = 0;
let connectedAt: string | null = null;
let lastMessageAt: string | null = null;
let lastPongAt: string | null = null;
let lastTradeAt: string | null = null;
let mainnetVerified = false;
let logsReceived = 0;
let tradesReceived = 0;
let failedProgramTransactions = 0;
let lastError: string | null = null;
let connectionState: PumpStreamStatus["connectionState"] = "disabled";

function publishStatus() {
  const status = getPumpStreamStatus();
  for (const client of clients) {
    try { client.onStatus(status); } catch { clients.delete(client); }
  }
}

function setProgramStates(state: PumpProgramStreamState["subscription"]) {
  for (const program of PUMP_PROGRAMS) programStates.set(program.id, state);
}

export function getPumpStreamStatus(): PumpStreamStatus {
  return {
    enabled: started,
    connectionState,
    cluster: mainnetVerified ? "mainnet-beta" : null,
    mainnetVerified,
    protocol: "Solana logsSubscribe",
    commitment: "confirmed",
    connectedAt,
    lastMessageAt,
    lastPongAt,
    lastTradeAt,
    logsReceived,
    tradesReceived,
    failedProgramTransactions,
    reconnects: reconnectCount,
    lastError,
    programs: PUMP_PROGRAMS.map(program => ({ ...program, subscription: programStates.get(program.id) ?? "pending" })),
  };
}

export function getRecentPumpTrades() {
  return [...recentTrades];
}

export function subscribePumpStream(client: StreamClient) {
  if (idleStopTimer) clearTimeout(idleStopTimer);
  idleStopTimer = null;
  clients.add(client);
  client.onStatus(getPumpStreamStatus());
  return () => {
    clients.delete(client);
    if (clients.size === 0 && started && !idleStopTimer) {
      idleStopTimer = setTimeout(() => {
        idleStopTimer = null;
        stopPumpTradeStream();
      }, IDLE_STOP_MS);
    }
  };
}

function rawToUtf8(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return String(raw);
}

export function extractPumpTradeInstructions(logs: string[], programId: string): PumpInstruction[] {
  const stack: string[] = [];
  const found = new Map<string, PumpInstruction>();

  for (const line of logs) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]);
      stack.length = Math.max(0, depth - 1);
      stack.push(invoke[1]);
      continue;
    }

    const exit = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed:.*)$/.exec(line);
    if (exit) {
      const index = stack.lastIndexOf(exit[1]);
      if (index >= 0) stack.length = index;
      continue;
    }

    if (!stack.includes(programId)) continue;
    const match = /^Program log: Instruction: ([A-Za-z0-9_]+)$/.exec(line);
    if (!match) continue;
    const instruction = match[1];
    const normalized = instruction.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (!/^(buy|sell)(?:_[a-z0-9]+)*$/.test(normalized)) continue;
    const parsed = { side: normalized.startsWith("buy") ? "BUY" as const : "SELL" as const, instruction };
    found.set(normalized, parsed);
  }

  return [...found.values()];
}

function scheduleReconnect() {
  if (!started || retryTimer) return;
  const ceiling = Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** Math.min(retryAttempt, 6));
  const delay = Math.floor(ceiling * (0.75 + Math.random() * 0.5));
  retryAttempt += 1;
  reconnectCount += 1;
  connectionState = "reconnecting";
  setProgramStates("pending");
  publishStatus();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectMainnet();
  }, delay);
}

function onTrade(programId: string, notification: JsonRpcMessage["params"], value: NotificationValue) {
  if (value.err !== null && value.err !== undefined) {
    failedProgramTransactions += 1;
    return;
  }
  if (typeof value.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value.signature)) return;
  const slot = notification?.result?.context?.slot;
  if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) return;
  if (!Array.isArray(value.logs) || !value.logs.every(line => typeof line === "string")) return;

  const program = programsByAddress.get(programId);
  if (!program) return;
  const instructions = extractPumpTradeInstructions(value.logs as string[], program.address);
  if (!instructions.length) return;

  const id = `${program.id}:${value.signature}`;
  if (seenEventIds.has(id)) return;
  seenEventIds.set(id, Date.now());
  while (seenEventIds.size > MAX_SEEN_EVENTS) {
    const oldest = seenEventIds.keys().next().value;
    if (oldest === undefined) break;
    seenEventIds.delete(oldest);
  }

  const sides = new Set(instructions.map(instruction => instruction.side));
  const side = sides.size > 1 ? "MIXED" : instructions[0]!.side;
  const event: PumpTradeEvent = {
    id,
    signature: value.signature,
    slot,
    program: program.name,
    programId: program.address,
    side,
    instructions: instructions.map(instruction => instruction.instruction),
    commitment: "confirmed",
    observedAt: new Date().toISOString(),
    source: "Helius mainnet logsSubscribe",
  };
  recentTrades.unshift(event);
  if (recentTrades.length > MAX_RECENT_TRADES) recentTrades.length = MAX_RECENT_TRADES;
  tradesReceived += 1;
  lastTradeAt = event.observedAt;
  for (const client of clients) {
    try { client.onTrade(event); } catch { clients.delete(client); }
  }
}

function handleMessage(current: WebSocket, raw: RawData) {
  if (socket !== current) return;
  let message: JsonRpcMessage;
  try { message = JSON.parse(rawToUtf8(raw)) as JsonRpcMessage; } catch { return; }

  if (typeof message.id === "number") {
    const programId = REQUEST_IDS.get(message.id);
    if (!programId) return;
    const program = programsById.get(programId);
    if (!program) return;
    if (message.error) {
      programStates.set(program.id, "unavailable");
      lastError = `Helius rejected the ${program.name} logs subscription (JSON-RPC ${String(message.error.code ?? "error")}); endpoint credentials are withheld.`;
      publishStatus();
      current.close(1002, "subscription rejected");
      return;
    }
    if (typeof message.result !== "number") return;
    subscriptionToProgram.set(message.result, program.id);
    programStates.set(program.id, "live");
    if (PUMP_PROGRAMS.every(item => programStates.get(item.id) === "live")) {
      connectionState = "live";
      retryAttempt = 0;
      lastError = null;
      connectedAt = new Date().toISOString();
    } else {
      connectionState = "subscribing";
    }
    publishStatus();
    return;
  }

  if (message.method !== "logsNotification" || !message.params || typeof message.params.subscription !== "number") return;
  logsReceived += 1;
  lastMessageAt = new Date().toISOString();
  const programId = subscriptionToProgram.get(message.params.subscription);
  const value = message.params.result?.value;
  if (!programId || !value) return;
  const program = programsById.get(programId);
  if (!program) return;
  onTrade(program.address, message.params, value);
}

async function connectMainnet() {
  if (!started || socket) return;
  connectionState = retryAttempt ? "reconnecting" : "verifying-mainnet";
  mainnetVerified = false;
  setProgramStates("pending");
  publishStatus();

  try {
    await verifyHeliusMainnet();
    if (!started || socket) return;
    mainnetVerified = true;
    connectionState = "connecting";
    const current = new WebSocket(heliusMainnetWebSocketUrl(), { handshakeTimeout: 10_000, maxPayload: 1_048_576 });
    socket = current;

    current.on("open", () => {
      if (socket !== current) return;
      connectionState = "subscribing";
      subscriptionToProgram.clear();
      setProgramStates("pending");
      for (const [requestId, programId] of REQUEST_IDS) {
        const program = programsById.get(programId);
        if (!program) continue;
        current.send(JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "logsSubscribe",
          params: [{ mentions: [program.address] }, { commitment: "confirmed" }],
        }));
      }
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket === current && current.readyState === WebSocket.OPEN) current.ping();
      }, WS_PING_MS);
      publishStatus();
    });

    current.on("pong", () => {
      if (socket === current) lastPongAt = new Date().toISOString();
    });
    current.on("message", raw => handleMessage(current, raw));
    current.on("error", () => {
      if (socket !== current) return;
      lastError = "Helius WebSocket transport error; endpoint and API key are withheld.";
      publishStatus();
    });
    current.on("close", () => {
      if (socket !== current) return;
      socket = null;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      subscriptionToProgram.clear();
      if (!started) return;
      lastError = lastError ?? "Helius WebSocket closed; a reconnect is scheduled.";
      scheduleReconnect();
    });
  } catch {
    socket = null;
    mainnetVerified = false;
    connectionState = "unavailable";
    lastError = "Helius mainnet verification or WebSocket setup failed; no other cluster was attempted.";
    publishStatus();
    scheduleReconnect();
  }
}

export function startPumpTradeStream() {
  if (started) return;
  started = true;
  retryAttempt = 0;
  lastError = null;
  connectionState = "verifying-mainnet";
  setProgramStates("pending");
  publishStatus();
  void connectMainnet();
}

export function stopPumpTradeStream() {
  started = false;
  if (retryTimer) clearTimeout(retryTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (idleStopTimer) clearTimeout(idleStopTimer);
  retryTimer = null;
  pingTimer = null;
  idleStopTimer = null;
  subscriptionToProgram.clear();
  if (socket) {
    const current = socket;
    socket = null;
    if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) current.close(1000, "server shutdown");
  }
  connectionState = "disabled";
  mainnetVerified = false;
  lastError = null;
  setProgramStates("pending");
  publishStatus();
}
