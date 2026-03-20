# PredictionInsider API Tests

## Collection

- **PredictionInsider-API.postman_collection.json** — Postman Collection v2.1 with test scripts for main endpoints.

## Running tests

### Option 1: Postman app

1. Open Postman.
2. **Import** → Upload `PredictionInsider-API.postman_collection.json`.
3. Ensure the server is running: `npm run dev` (or `npx tsx server/index.ts` with `NODE_ENV=development`).
4. Set collection variable `baseUrl` to `http://127.0.0.1:5000` (or your server URL).
5. **Run collection** (Runner) and check test results.

### Option 2: Newman (CLI)

```bash
# Install Newman once
npm install -g newman

# Run the collection (start the server first)
newman run postman/PredictionInsider-API.postman_collection.json --env-var baseUrl=http://127.0.0.1:5000
```

### Endpoints covered

- **Health**: GET `/` (dashboard)
- **Signals**: GET `/api/signals?sports=true`, GET `/api/signals/fast?sports=true`
- **Markets**: GET `/api/markets?type=upcoming`, GET `/api/markets/search?q=nba`
- **Traders**: GET `/api/traders?category=sports`
- **Elite** (requires DB): GET `/api/elite/traders`
- **Bets** (requires DB): GET `/api/bets`
- **Alerts**: GET `/api/alerts/live`

Elite and Bets tests allow 500 when `DATABASE_URL` is not set.
