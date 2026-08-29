import fs from "fs";
import path from "path";
import {
  loadCopyDiscovery,
  loadRankedPlayBoard,
  mergeRankedPlays,
  type AnnotatedTakePlay,
  type CopyDiscoveryBundle,
  type RankedPlayBoardFile,
  type TakeHealthFile,
  type TakePlayBundle,
} from "./takePlays";

export interface TailDigestTrader {
  username?: string;
  wallet?: string;
  bucket?: string;
  joinable?: boolean;
  tail_score?: number;
  tail_why?: string;
  notes?: string;
  unique?: {
    roi?: number;
    win_rate?: number;
    median_stake?: number;
    last_30d_n?: number;
    last_30d_roi?: number;
    recency?: string;
    dashboard_pnl?: number;
  };
  take?: {
    n?: number;
    roi_2c?: number;
    win_rate?: number;
  };
  how_they_win?: {
    top_edge?: Array<{ key?: string; roi_2c?: number; n?: number; win_rate?: number }>;
    by_sport?: Array<{ key?: string; roi_2c?: number; n?: number }>;
  };
  clv?: {
    avg_clv_cents?: number | null;
    coverage?: number;
    n?: number;
  };
}

export interface AdaptiveTraderRow {
  username?: string;
  wallet?: string;
  bucket?: string;
  composite_score?: number;
  unique_roi?: number;
  joinability?: { score?: number };
  product?: { n?: number; roi?: number };
  adaptive?: { action?: string; why?: string };
  regime?: { regime?: string; why?: string };
  equity?: { consistency_score?: number };
}

export interface PolydataFind {
  username?: string;
  wallet?: string;
  rank?: number;
  pnl?: number;
  vol?: number;
  pnl_vol?: number;
  window?: string;
  on_roster?: boolean;
  reasons?: string[];
}

export interface ExcellenceTrader {
  username: string;
  wallet: string;
  bucket: string;
  excellenceScore: number;
  verdict: string;
  why: string[];
  uniqueRoi: number | null;
  takeN: number | null;
  takeRoi: number | null;
  last30Roi: number | null;
  last30N: number | null;
  medianStake: number | null;
  recency: string | null;
  compositeScore: number | null;
  insiderScore: number | null;
  action: string | null;
  topEdges: string[];
  joinable: boolean;
  polymarketUrl: string;
}

export interface UnusualFlowFlagged {
  wallet?: string;
  name?: string;
  outcome?: string;
  amount?: number;
  z?: number;
  q?: number | null;
  open_markets?: number | null;
  trade_depth?: number | null;
  wallet_age_days?: number | null;
  fresh?: boolean;
  tags?: string[];
  polymarket_profile?: string;
}

export interface UnusualFlowMarket {
  rank?: number;
  conditionId?: string;
  question?: string;
  event_title?: string;
  slug?: string;
  url?: string;
  sports_ish?: boolean;
  volume24hr?: number;
  unusual_score?: number;
  tags?: string[];
  smart_gap?: number | null;
  days_to_end?: number | null;
  prices?: number[];
  outcomes?: string[];
  flagged?: UnusualFlowFlagged[];
}

export interface UnusualFlowInsider {
  rank?: number;
  z?: number;
  name?: string;
  wallet?: string;
  outcome?: string;
  amount?: number;
  open_markets?: number | null;
  trade_depth?: number | null;
  fresh?: boolean;
  q?: number | null;
  tags?: string[];
  sports_ish?: boolean;
  lane?: string;
  market?: string;
  unusual_score?: number;
  url?: string;
  polymarket_profile?: string;
}

export interface HotWalletLight {
  light_q?: number;
  n?: number;
  win_rate?: number | null;
  roi_pct?: number | null;
}

export interface HotWalletResult {
  wallet?: string;
  username?: string;
  z?: number;
  lane?: string;
  sports_ish?: boolean;
  market?: string;
  tags?: string[];
  action?: string;
  gate_reasons?: string[];
  light?: HotWalletLight;
  polymarket_profile?: string;
  url?: string;
}

export interface HotWalletDiscoveries {
  generated_at?: string;
  method?: string;
  counts?: {
    candidates?: number;
    scored?: number;
    accepted?: number;
    enqueued?: number;
    enqueued_sports?: number;
    enqueued_macro?: number;
    csv_fetched?: number;
    watch_roster?: number;
  };
  enqueued?: Array<{
    wallet?: string;
    username?: string;
    source?: string;
    status?: string;
    notes?: string;
    discovered_at?: string;
    discovery?: Record<string, unknown>;
  }>;
  watch_roster?: Array<{
    wallet?: string;
    username?: string;
    source?: string;
    status?: string;
    notes?: string;
    discovered_at?: string;
    discovery?: Record<string, unknown>;
  }>;
  results?: HotWalletResult[];
}

export interface UnusualFlowBoard {
  generated_at?: string;
  method?: string;
  counts?: {
    markets_fetched?: number;
    markets_scored?: number;
    wallet_alerts?: number;
    known_q?: number;
  };
  markets?: UnusualFlowMarket[];
  potential_insiders?: UnusualFlowInsider[];
}

export interface PredictionInsidersBundle {
  generatedAt: string | null;
  rule: string | null;
  method: string;
  counts: {
    plays: number;
    take: number;
    near: number;
    watch: number;
    traders: number;
    newFinds: number;
    booksScanned: number;
    unusualMarkets: number;
    potentialInsiders: number;
    hotEnqueued: number;
    hotCandidates: number;
  };
  plays: AnnotatedTakePlay[];
  traders: ExcellenceTrader[];
  newFinds: PolydataFind[];
  discovery: CopyDiscoveryBundle;
  rankedBoard: RankedPlayBoardFile | null;
  unusualFlow: UnusualFlowBoard | null;
  hotDiscoveries: HotWalletDiscoveries | null;
  trust?: {
    takeHealth?: TakeHealthFileLite | null;
    walkforward?: WalkforwardTrust | null;
    bankroll?: BankrollTrust | null;
  };
}

export interface TakeHealthFileLite {
  status?: string;
  pause_reason?: string | null;
  windows?: Record<string, { n?: number; win_rate?: number | null; roi_2c?: number | null }>;
  generated_at?: string;
}

export interface WalkforwardTrust {
  generated_at?: string;
  best_at_2c_slip_n50?: { id?: string; n?: number; roi?: number; win_rate?: number };
  calibration_by_grade_band?: Array<{ band?: string; n?: number; roi?: number }>;
}

export interface BankrollTrust {
  generated_at?: string;
  flat_100?: { n?: number; roi_on_start?: number; sharpe_daily_roi?: number; max_dd_pct?: number };
  sizing?: { kelly_half?: { avg_stake?: number; roi_on_start?: number } };
}

function loadJson<T>(rel: string): T | null {
  const p = path.join(process.cwd(), rel);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (err) {
    console.error(`[prediction-insiders] failed to read ${rel}:`, err);
    return null;
  }
}

export function loadHotWalletDiscoveries(): HotWalletDiscoveries | null {
  return loadJson<HotWalletDiscoveries>("pnl_analysis/output/hot_wallet_discoveries.json");
}

/** Count wallets currently on watch from unusual-flow hot discovery (cumulative). */
export function countUnusualFlowWatches(): number {
  const extra = loadJson<Array<{ source?: string; status?: string }>>("pnl_analysis/extra_traders.json");
  if (!Array.isArray(extra)) return 0;
  return extra.filter((r) => {
    const src = String(r.source || "");
    const st = String(r.status || "");
    return src.startsWith("unusual_flow") && (st === "watch" || st === "take_book");
  }).length;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildExcellenceTraders(
  digest: TailDigestTrader[],
  adaptive: AdaptiveTraderRow[],
  insiderByWallet: Map<string, { insider_score?: number }>,
): ExcellenceTrader[] {
  const adaptiveByUser = new Map(
    adaptive.filter((r) => r.username).map((r) => [String(r.username).toLowerCase(), r]),
  );
  return digest
    .map((d) => {
      const username = String(d.username || "");
      const wallet = String(d.wallet || "").toLowerCase();
      const lab = adaptiveByUser.get(username.toLowerCase());
      const insider = insiderByWallet.get(wallet);
      const unique = d.unique || {};
      const take = d.take || {};
      const topEdges = (d.how_they_win?.top_edge || d.how_they_win?.by_sport || [])
        .slice(0, 3)
        .map((e) => `${e.key || "?"} ${e.roi_2c ?? "—"}% (n=${e.n ?? "?"})`);
      const tailScore = num(d.tail_score) ?? 0;
      const composite = num(lab?.composite_score);
      const insiderScore = num(insider?.insider_score);
      const excellenceScore = Math.round(
        Math.max(tailScore, composite ?? 0) * 0.55 + (insiderScore ?? tailScore) * 0.45,
      );
      const why: string[] = [];
      if (d.tail_why) why.push(String(d.tail_why));
      if (lab?.adaptive?.why) why.push(String(lab.adaptive.why));
      if (lab?.regime?.regime) why.push(`Regime: ${lab.regime.regime}`);
      if (take.n != null && take.n >= 12) {
        why.push(`Take-rule track: n=${take.n}, ${take.roi_2c ?? "—"}% after 2¢`);
      }
      if (topEdges.length) why.push(`Edges: ${topEdges.join("; ")}`);
      return {
        username,
        wallet,
        bucket: String(d.bucket || "watch"),
        excellenceScore,
        verdict: String(d.tail_why || lab?.adaptive?.action || "screen"),
        why,
        uniqueRoi: num(unique.roi),
        takeN: num(take.n),
        takeRoi: num(take.roi_2c),
        last30Roi: num(unique.last_30d_roi),
        last30N: num(unique.last_30d_n),
        medianStake: num(unique.median_stake),
        recency: unique.recency ? String(unique.recency) : null,
        compositeScore: composite,
        insiderScore,
        action: lab?.adaptive?.action ? String(lab.adaptive.action) : null,
        topEdges,
        joinable: Boolean(d.joinable),
        polymarketUrl: wallet ? `https://polymarket.com/profile/${wallet}` : "",
      };
    })
    .sort((a, b) => b.excellenceScore - a.excellenceScore);
}

export function loadPredictionInsiders(
  bundle: TakePlayBundle,
  health: TakeHealthFile | null,
): PredictionInsidersBundle {
  const board = loadRankedPlayBoard();
  const plays = mergeRankedPlays(bundle, health, board);
  const digestFile = loadJson<{ generated_at?: string; traders?: TailDigestTrader[] }>(
    "pnl_analysis/output/tail_digest.json",
  );
  const labFile = loadJson<{ traders?: AdaptiveTraderRow[] }>("pnl_analysis/output/adaptive_copy_lab.json");
  const ranksFile = loadJson<{ traders?: Array<{ wallet?: string; insider_score?: number }> }>(
    "pnl_analysis/output/insider_ranks.json",
  );
  const polyFile = loadJson<{ sports_survivors?: PolydataFind[] }>("pnl_analysis/output/polydata_boards.json");
  const unusualFlow = loadJson<UnusualFlowBoard>("pnl_analysis/output/unusual_flow.json");
  const hotDiscoveries = loadHotWalletDiscoveries();

  const insiderByWallet = new Map<string, { insider_score?: number }>();
  for (const t of ranksFile?.traders || []) {
    if (t.wallet) insiderByWallet.set(String(t.wallet).toLowerCase(), t);
  }

  const digest = digestFile?.traders || [];
  const traders = buildExcellenceTraders(digest, labFile?.traders || [], insiderByWallet);

  const newFinds = (polyFile?.sports_survivors || [])
    .filter((r) => !r.on_roster && (r.reasons || []).length === 0)
    .slice(0, 30);

  const counts = board?.counts || {};
  const unusualMarkets = unusualFlow?.markets?.length ?? 0;
  const potentialInsiders = unusualFlow?.potential_insiders?.length ?? 0;
  const hotWatchCount = countUnusualFlowWatches();
  const hotEnqueued =
    hotWatchCount > 0
      ? hotWatchCount
      : (hotDiscoveries?.counts?.enqueued ?? hotDiscoveries?.enqueued?.length ?? 0);
  const hotCandidates = hotDiscoveries?.counts?.candidates ?? 0;
  return {
    generatedAt:
      hotDiscoveries?.generated_at
      || board?.generated_at
      || unusualFlow?.generated_at
      || digestFile?.generated_at
      || health?.generated_at
      || null,
    rule: board?.rule || "asof_live_q60_sport_rel2",
    method:
      "Sniper TAKE (as-of Q60+sport+2×) + OddsJam-style graded opens + "
      + "UW/Hashdive-style unusual flow (holder Z-score) + hot-wallet discovery "
      + "(Z→light Q→watch enqueue only — no cold full pipeline).",
    counts: {
      plays: plays.length,
      take: counts.take ?? plays.filter((p) => p.list === "take").length,
      near: counts.near ?? plays.filter((p) => p.list === "near").length,
      watch: counts.watch ?? plays.filter((p) => p.list === "watch").length,
      traders: traders.length,
      newFinds: newFinds.length,
      booksScanned: board?.books_scanned ?? 0,
      unusualMarkets,
      potentialInsiders,
      hotEnqueued,
      hotCandidates,
    },
    plays,
    traders,
    newFinds,
    discovery: loadCopyDiscovery(),
    rankedBoard: board,
    unusualFlow,
    hotDiscoveries,
    trust: {
      takeHealth: health
        ? {
            status: health.status,
            pause_reason: health.pause_reason,
            windows: health.windows,
            generated_at: health.generated_at,
          }
        : loadJson<TakeHealthFileLite>("pnl_analysis/output/take_health.json"),
      walkforward: loadJson<WalkforwardTrust>("pnl_analysis/output/walkforward_tail_backtest.json"),
      bankroll: loadJson<BankrollTrust>("pnl_analysis/output/take_book_bankroll.json"),
    },
  };
}
