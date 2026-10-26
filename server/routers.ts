import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getCandles, getMarketSnapshot, getWalletActivity, isValidSolanaPublicKey, lookupToken, searchTokens } from "./providers/solana";

const addressSchema = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).refine(isValidSolanaPublicKey, "Address must decode to a 32-byte Solana public key.");
const requestWindows = new Map<string, number[]>();
function enforceRequestRateLimit(ip: string, route: string, limit: number) {
  const now = Date.now();
  const key = `${ip}:${route}`;
  const timestamps = (requestWindows.get(key) ?? []).filter(timestamp => now - timestamp < 60_000);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  requestWindows.set(key, timestamps);
  if (requestWindows.size > 2_000) {
    const oldest = requestWindows.keys().next().value;
    if (oldest !== undefined) requestWindows.delete(oldest);
  }
  return true;
}
function requireRequestBudget(ip: string, route: string, limit: number) {
  if (!enforceRequestRateLimit(ip, route, limit)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Cotra ${route} rate limit reached. Retry after one minute.` });
}
function requestIp(req: { ip?: string; socket?: { remoteAddress?: string } }) { return req.ip || req.socket?.remoteAddress || "unknown"; }

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  market: router({
    snapshot: publicProcedure.query(({ ctx }) => {
      requireRequestBudget(requestIp(ctx.req), "market snapshot", 30);
      return getMarketSnapshot();
    }),
    search: publicProcedure.input(z.object({ query: z.string().trim().min(2).max(80) })).query(({ input, ctx }) => {
      requireRequestBudget(requestIp(ctx.req), "token search", 20);
      return searchTokens(input.query);
    }),
    token: publicProcedure.input(z.object({ mint: addressSchema })).query(({ input, ctx }) => {
      requireRequestBudget(requestIp(ctx.req), "token detail", 15);
      return lookupToken(input.mint);
    }),
    candles: publicProcedure.input(z.object({ mint: addressSchema, timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]) })).query(({ input, ctx }) => {
      requireRequestBudget(requestIp(ctx.req), "token candles", 6);
      return getCandles(input.mint, input.timeframe);
    }),
    walletActivity: publicProcedure.input(z.object({ address: addressSchema })).query(({ input, ctx }) => {
      requireRequestBudget(requestIp(ctx.req), "wallet lookup", 6);
      return getWalletActivity(input.address);
    }),
  }),
});

export type AppRouter = typeof appRouter;
