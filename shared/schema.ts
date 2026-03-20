import { z } from "zod";

export const traderSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  xUsername: z.string().optional(),
  verifiedBadge: z.boolean().optional(),
  pnl: z.number(),
  realizedPNL: z.number().optional(),
  unrealizedPNL: z.number().optional(),
  pnlSource: z.string().optional(),
  closedPositionCount: z.number().optional(),
  roi: z.number(),
  tradesCount: z.number().optional(),
  positionCount: z.number().optional(),
  winRate: z.number(),
  avgSize: z.number(),
  volume: z.number(),
  rank: z.number(),
  qualityScore: z.number().optional(),
  tier: z.enum(["elite", "pro", "active"]).optional(),
  polyAnalyticsUrl: z.string().optional(),
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

export const signalTraderSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  entryPrice: z.number(),
  size: z.number(),
  netUsdc: z.number().optional(),
  riskUsdc: z.number().optional(),
  roi: z.number(),
  qualityScore: z.number().optional(),
  pnl: z.number().optional(),
  isLeaderboard: z.boolean().optional(),
  isSportsLb: z.boolean().optional(),
  tradeTime: z.number().optional(),
  winRate: z.number().optional(),
  totalTrades: z.number().optional(),
  sportRoi: z.number().nullable().optional(),
  sportTradeCount: z.number().optional(),
  sportWinRate: z.number().optional(),
  sportAvgBet: z.number().optional(),
  tags: z.array(z.string()).optional(),
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
  totalNetUsdc: z.number().optional(),
  avgNetUsdc: z.number().optional(),
  totalRiskUsdc: z.number().optional(),
  avgRiskUsdc: z.number().optional(),
  traderCount: z.number(),
  lbTraderCount: z.number().optional(),
  sportsLbCount: z.number().optional(),
  counterTraderCount: z.number().optional(),
  avgQuality: z.number().optional(),
  traders: z.array(signalTraderSchema),
  counterTraders: z.array(z.any()).optional(),
  category: z.string(),
  sport: z.string().optional(),
  volume: z.number(),
  generatedAt: z.number(),
  isValue: z.boolean(),
  isNew: z.boolean().optional(),
  isActionable: z.boolean().optional(),
  priceStatus: z.string().optional(),
  source: z.string().optional(),
  marketType: z.string().optional(),
  marketCategory: z.string().optional(),
  tier: z.string().optional(),
  bigPlayScore: z.number().optional(),
  relBetSize: z.number().optional(),
  slippagePct: z.number().optional(),
  insiderSportsROI: z.number().optional(),
  insiderTrades: z.number().optional(),
  insiderWinRate: z.number().optional(),
  scoreBreakdown: z.any().optional(),
  outcomeLabel: z.string().optional(),
  yesTokenId: z.string().optional(),
  noTokenId: z.string().optional(),
  hasCuratedElite: z.boolean().optional(),
  curatedEliteSplit: z.boolean().optional(),
  curatedElites: z.array(z.any()).optional(),
  clusterBoost: z.any().optional(),
  /** High-Q trader(s) in a statistically strong lane + large stake — relaxed cluster gates, sort boost */
  vipPremium: z.boolean().optional(),
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
  gameStartTime: z.string().optional(),
  active: z.boolean(),
  traderCount: z.number(),
  bestBid: z.number().optional(),
  bestAsk: z.number().optional(),
  conditionId: z.string().optional(),
  tokenIds: z.array(z.string()).optional(),
  source: z.enum(["polymarket", "kalshi"]).optional(),
});

export const leaderboardResponseSchema = z.object({
  traders: z.array(traderSchema),
  fetchedAt: z.number(),
  window: z.string(),
  category: z.string().optional(),
  source: z.string().optional(),
});

export const signalsResponseSchema = z.object({
  signals: z.array(signalSchema),
  topTraderCount: z.number(),
  marketsScanned: z.number(),
  newSignalCount: z.number().optional(),
  fetchedAt: z.number(),
  source: z.string().optional(),
});

export const marketsResponseSchema = z.object({
  markets: z.array(marketSchema),
  fetchedAt: z.number(),
  total: z.number(),
  polymarketCount: z.number().optional(),
  kalshiCount: z.number().optional(),
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
