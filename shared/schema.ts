import { z } from "zod";

export const traderSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  pnl: z.number(),
  roi: z.number(),
  tradesCount: z.number(),
  winRate: z.number(),
  avgSize: z.number(),
  volume: z.number(),
  rank: z.number(),
});

export const tradeSchema = z.object({
  id: z.string(),
  userAddress: z.string(),
  marketId: z.string(),
  marketQuestion: z.string(),
  conditionId: z.string().optional(),
  tokenId: z.string().optional(),
  entryPrice: z.number(),
  size: z.number(),
  side: z.enum(["BUY", "SELL"]),
  outcome: z.string(),
  timestamp: z.number(),
  slug: z.string().optional(),
});

export const signalSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  marketQuestion: z.string(),
  slug: z.string().optional(),
  outcome: z.string(),
  side: z.enum(["YES", "NO"]),
  confidence: z.number(),
  consensusPct: z.number(),
  valueDelta: z.number(),
  currentPrice: z.number(),
  avgEntryPrice: z.number(),
  traderCount: z.number(),
  traders: z.array(z.object({
    address: z.string(),
    name: z.string().optional(),
    entryPrice: z.number(),
    size: z.number(),
    roi: z.number(),
  })),
  category: z.string(),
  volume: z.number(),
  generatedAt: z.number(),
  isValue: z.boolean(),
});

export const marketSchema = z.object({
  id: z.string(),
  question: z.string(),
  slug: z.string().optional(),
  category: z.string(),
  currentPrice: z.number(),
  volume: z.number(),
  liquidity: z.number(),
  endDate: z.string().optional(),
  active: z.boolean(),
  traderCount: z.number(),
  bestBid: z.number().optional(),
  bestAsk: z.number().optional(),
  conditionId: z.string().optional(),
  tokenIds: z.array(z.string()).optional(),
});

export const leaderboardResponseSchema = z.object({
  traders: z.array(traderSchema),
  fetchedAt: z.number(),
  window: z.string(),
});

export const signalsResponseSchema = z.object({
  signals: z.array(signalSchema),
  topTraderCount: z.number(),
  marketsScanned: z.number(),
  fetchedAt: z.number(),
});

export const marketsResponseSchema = z.object({
  markets: z.array(marketSchema),
  fetchedAt: z.number(),
  total: z.number(),
});

export type Trader = z.infer<typeof traderSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type Market = z.infer<typeof marketSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type SignalsResponse = z.infer<typeof signalsResponseSchema>;
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;

export const users = {
  $inferSelect: {} as { id: string; username: string; password: string },
};
export type User = { id: string; username: string; password: string };
export type InsertUser = { username: string; password: string };
