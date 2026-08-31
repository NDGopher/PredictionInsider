# Local sync (Windows) — what the git error means

## What happened

Your machine already had **local pipeline output** (re-runs of ranks / hot-copy / backtests / trader JSONs).  
Remote `origin/cursor/hot-copy-polydata-51c7` also updated those **same tracked files**.

`git pull` refused to overwrite your local copies. That is Git protecting you — not a corrupt repo.

Two buckets:

1. **Modified tracked files** — e.g. `HOT_COPY_SCREEN.md`, `copy_universe.json`, `insider_ranks.json`, trader `*.json`  
2. **Untracked files that also exist on remote** — e.g. `take_open_scan.json`, `HongYunX_*.json`, `HVAB_*.json`  
   Git will not clobber untracked files either.

Your **CSV dumps** (`*.csv` under `pnl_analysis/output/`) are usually **gitignored** and can stay; they are not the pull blockers.

## Recommended fix (keep local CSVs, take remote product JSON)

PowerShell from `C:\PredictionInsider`:

```powershell
# 1) Park everything that blocks the pull (includes untracked)
git stash push -u -m "local pipeline before pull"

# 2) Fast-forward to cloud branch
git pull origin cursor/hot-copy-polydata-51c7

# 3) Optional: if you need local CSV trade dumps back from stash
git checkout stash@{0} -- pnl_analysis/output/*.csv 2>$null
# If that fails, restore whole stash then re-copy only CSVs manually:
#   git stash show -p stash@{0} | Out-Null
#   git stash pop   # only if you know you want the mess back

# 4) Drop the stash once you confirm pull looks good
git stash drop
```

### Nuclear (simplest if local product JSON does not matter)

```powershell
# Backup CSVs only
New-Item -ItemType Directory -Force -Path C:\PredictionInsider\_csv_backup | Out-Null
Copy-Item pnl_analysis\output\*.csv C:\PredictionInsider\_csv_backup\ -ErrorAction SilentlyContinue

git fetch origin
git reset --hard origin/cursor/hot-copy-polydata-51c7
git clean -fd pnl_analysis/output/*.json
# leave CSVs alone if gitignored; restore from backup if wiped:
Copy-Item C:\PredictionInsider\_csv_backup\*.csv pnl_analysis\output\ -Force -ErrorAction SilentlyContinue
```

After sync, grab:

- `pnl_analysis/TAIL_DIGEST.md` — **who wins how, take-rule, CLV**
- `pnl_analysis/WORKING_COPY_MODEL.md`
- `pnl_analysis/output/tail_digest.json`
- `pnl_analysis/output/working_copy_model.json`
- `pnl_analysis/output/take_open_scan.json`

Rebuild locally:

```powershell
cd C:\PredictionInsider
npm run model:rebuild
npm run model:digest
```
