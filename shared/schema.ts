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
  /** Curated futures specialist (0x53eCc53E7) with ≥$5K at risk on this macro-futures market */
  futuresExpertLargeStakeUsd: z.number().optional(),
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

export const deskEquityPointSchema = z.object({
  t: z.string(),
  equity: z.number(),
  pnl: z.number().optional(),
});

export const deskTraderWouldHaveSchema = z.object({
  username: z.string(),
  wallet: z.string().optional(),
  displayName: z.string(),
  n: z.number(),
  winRate: z.number().nullable(),
  roi2c: z.number().nullable(),
  pnl2c: z.number().nullable(),
  maxDd: z.number().nullable(),
  equityEnd: z.number().nullable(),
  equityCurve: z.array(deskEquityPointSchema),
  last: z.string().nullable().optional(),
});

export const deskRosterRowSchema = z.object({
  username: z.string(),
  wallet: z.string(),
  displayName: z.string(),
  bucket: z.string(),
  extraStatus: z.string().nullable().optional(),
  joinable: z.boolean().optional(),
  recency: z.string().optional(),
  winRate: z.number().nullable().optional(),
  uniqueRoi: z.number().nullable().optional(),
  last30n: z.number().nullable().optional(),
  last30Roi: z.number().nullable().optional(),
  whyTail: z.string().optional(),
  reasons: z.array(z.string()),
  promoteReason: z.string().nullable().optional(),
  demoteReason: z.string().nullable().optional(),
  pathB: z.boolean().optional(),
});

export const deskActionSchema = z.object({
  username: z.string().optional(),
  displayName: z.string().optional(),
  wallet: z.string().optional(),
  action: z.string().optional(),
  why: z.string().optional(),
});

export const deskWouldHavePlaySchema = z.object({
  end: z.string(),
  username: z.string().optional(),
  displayName: z.string(),
  play: z.string(),
  won: z.boolean(),
  fill: z.number().optional(),
  pnl_2c: z.number(),
  equity: z.number().optional(),
});

export const deskRankedPlaySchema = z.object({
  rank: z.number(),
  rankScore: z.number(),
  whyRank: z.string(),
  takeLane: z.enum(["TAKE", "NEAR", "SKIP"]),
  id: z.string(),
  displayName: z.string(),
  traders: z.array(z.string()),
  playLabel: z.string(),
  marketQuestion: z.string(),
  sport: z.string().optional(),
  submarket: z.string(),
  q: z.number(),
  rel: z.number(),
  sportRoi: z.number().nullable(),
  edgeCents: z.number(),
  liveAsk: z.number().nullable(),
  takeCap: z.number(),
  fillable: z.boolean(),
  fillability: z.number(),
  misses: z.array(z.string()),
  url: z.string().optional(),
  slug: z.string().optional(),
});

export const deskDiscoverySchema = z.object({
  generatedAt: z.string().nullable(),
  method: z.string(),
  recommended: z.number(),
  unresolved: z.number(),
  scoutsAdded: z.number(),
  names: z.array(z.object({
    displayName: z.string(),
    username: z.string().optional(),
    source: z.string().optional(),
    why: z.string().optional(),
  })),
});

export const deskResponseSchema = z.object({
  generatedAt: z.string().nullable(),
  asOf: z.string().nullable(),
  invented: z.boolean(),
  blockedReason: z.string().nullable().optional(),
  howToRead: z.string(),
  promoteHow: z.string(),
  takeNearDiagnose: z.string(),
  stillBlocked: z.array(z.string()),
  book: z.object({
    n: z.number(),
    winRate: z.number().nullable(),
    roi2c: z.number().nullable(),
    pnl2c: z.number().nullable(),
  }),
  now: z.object({
    take: z.number(),
    near: z.number(),
    skip: z.number(),
    paused: z.boolean(),
    pauseReason: z.string().nullable().optional(),
  }),
  roster: z.array(deskRosterRowSchema),
  wouldHave: z.array(deskTraderWouldHaveSchema),
  plays: z.array(deskWouldHavePlaySchema),
  equityCurve: z.array(deskEquityPointSchema),
  takeTickets: z.array(deskRankedPlaySchema).optional(),
  rankedPlays: z.array(deskRankedPlaySchema).optional(),
  rankHow: z.string().optional(),
  discovery: deskDiscoverySchema.optional(),
  actions: z.object({
    promoted: z.array(deskActionSchema),
    demoted: z.array(deskActionSchema),
    benched: z.array(deskActionSchema),
    scoutsAdded: z.array(deskActionSchema),
  }),
  blockedTraders: z.array(z.object({
    username: z.string().optional(),
    displayName: z.string(),
    why: z.string(),
  })),
  ingest: z.object({
    source: z.string(),
    lastFetchAt: z.string().nullable(),
    refreshMinutes: z.number(),
    walletsTracked: z.number(),
    unresolved: z.number(),
    fills: z.number(),
    running: z.boolean().optional(),
  }).optional(),
});

export type Trader = z.infer<typeof traderSchema>;
export type DeskResponse = z.infer<typeof deskResponseSchema>;
export type DeskRosterRow = z.infer<typeof deskRosterRowSchema>;
export type DeskTraderWouldHave = z.infer<typeof deskTraderWouldHaveSchema>;
export type DeskRankedPlay = z.infer<typeof deskRankedPlaySchema>;
export type DeskDiscovery = z.infer<typeof deskDiscoverySchema>;
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
