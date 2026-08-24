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
  };
  plays: AnnotatedTakePlay[];
  traders: ExcellenceTrader[];
  newFinds: PolydataFind[];
  discovery: CopyDiscoveryBundle;
  rankedBoard: RankedPlayBoardFile | null;
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
  return {
    generatedAt:
      board?.generated_at || digestFile?.generated_at || health?.generated_at || null,
    rule: board?.rule || "asof_live_q60_sport_rel2",
    method:
      "OddsJam-style board: ranked opens + digested trader excellence + Polydata discovery. "
      + "Grades 0–100 with explicit why on every play and trader.",
    counts: {
      plays: plays.length,
      take: counts.take ?? plays.filter((p) => p.list === "take").length,
      near: counts.near ?? plays.filter((p) => p.list === "near").length,
      watch: counts.watch ?? plays.filter((p) => p.list === "watch").length,
      traders: traders.length,
      newFinds: newFinds.length,
      booksScanned: board?.books_scanned ?? 0,
    },
    plays,
    traders,
    newFinds,
    discovery: loadCopyDiscovery(),
    rankedBoard: board,
  };
}
