/**
 * How long after a successful ingest before we skip smart refresh / background pipeline.
 * Override with env PI_SMART_REFRESH_HOURS (1–168). Default 6h keeps rankings fresher than 24h.
 */
export function getSmartRefreshIntervalMs(): number {
  const raw = process.env.PI_SMART_REFRESH_HOURS;
  const parsed = raw === undefined || raw === "" ? 6 : parseFloat(raw);
  const hours = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(parsed, 1), 168) : 6;
  return hours * 60 * 60 * 1000;
}
