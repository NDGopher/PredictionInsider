/**
 * Compare total_profit in _all_analysis.json vs sum(realizedPnl) from each trader CSV.
 * CSV is event-level (hedge/bond stripped) so totals can differ; we check ballpark.
 */
import fs from "fs";
import path from "path";

const outputDir = path.join(process.cwd(), "pnl_analysis", "output");
const allPath = path.join(outputDir, "_all_analysis.json");
const all = JSON.parse(fs.readFileSync(allPath, "utf8"));

function parseCsvSum(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const idx = headers.indexOf("realizedPnl");
  if (idx === -1) return null;
  let sum = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const val = parseFloat(parts[idx]);
    if (!Number.isNaN(val)) sum += val;
  }
  return sum;
}

const results = [];
for (const t of all) {
  const username = t.username;
  const wallet8 = (t.wallet || "").slice(2, 10).toLowerCase();
  const analysisPnL = t.total_profit ?? 0;
  let csvSum = null;
  const wallet6 = (t.wallet || "").slice(2, 8).toLowerCase();
  const candidates = [
    path.join(outputDir, `${username}_0x${wallet6}.csv`),
    path.join(outputDir, `${username.replace(/[^a-zA-Z0-9]/g, "")}_0x${wallet6}.csv`),
  ];
  const files = fs.readdirSync(outputDir);
  const match = files.find(f => f.endsWith(`_0x${wallet6}.csv`) && !f.includes("trades") && !f.includes("breakdown"));
  if (match) candidates.unshift(path.join(outputDir, match));
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    csvSum = parseCsvSum(p);
    if (csvSum != null) break;
  }
  const diff = csvSum != null ? analysisPnL - csvSum : null;
  const pct = csvSum != null && csvSum !== 0 ? ((diff / Math.abs(csvSum)) * 100).toFixed(1) : null;
  results.push({
    username,
    analysisPnL: Math.round(analysisPnL * 100) / 100,
    csvSum: csvSum != null ? Math.round(csvSum * 100) / 100 : null,
    diff: diff != null ? Math.round(diff * 100) / 100 : null,
    pctDiff: pct,
  });
}

console.log("Username\tAnalysis PnL\tCSV sum(realizedPnl)\tDiff\t% diff");
for (const r of results) {
  const csvStr = r.csvSum != null ? r.csvSum.toLocaleString() : "N/A";
  const diffStr = r.diff != null ? r.diff.toLocaleString() : "N/A";
  const pctStr = r.pctDiff != null ? r.pctDiff + "%" : "N/A";
  console.log(`${r.username}\t${r.analysisPnL.toLocaleString()}\t${csvStr}\t${diffStr}\t${pctStr}`);
}
const withCsv = results.filter(r => r.csvSum != null);
const bigDiffs = withCsv.filter(r => r.diff != null && Math.abs(r.diff) > 5000);
console.log("\n--- Summary ---");
console.log("Traders with CSV:", withCsv.length);
console.log("Large diff (>5k):", bigDiffs.length);
if (bigDiffs.length) bigDiffs.forEach(r => console.log("  ", r.username, "diff", r.diff));
