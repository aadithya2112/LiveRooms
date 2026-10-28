# Deployment preparation

The previous push-triggered VM deployment workflow has been removed; it remains available in Git history. No production deployment is performed by the repository’s CI workflow. The frontend and signaling service are deployed separately. The old Socket.IO frontend and new native WebSocket backend are **not wire-compatible**: cut over both together or use a new signaling hostname.

## Current deployment

- Frontend: **https://rooms.aadithya.dev**
- Signaling: **https://liverooms-signaling.aadithyacps.workers.dev**
- Vercel project: `aadithya2112s-projects/live-rooms`, root directory `frontend`, with external workspace sources enabled.
- Worker: `liverooms-signaling`, configured by `worker/wrangler.production.jsonc`.
- TURN issuance is explicitly disabled in production (`TURN_ENABLED=false`); the deployed app currently supports direct peer connections only. Its Worker TURN secrets have been removed.
- Local development and CI use `worker/wrangler.jsonc`; keep its localhost allowlist separate from production.
- Vercel production and preview environments have the hosted signaling URL. Preview origins must be added explicitly to the Worker allowlist before calls work there.
- Vercel retains its existing deployment protection settings. The custom domain is public; preview/deployment URLs may require Vercel authentication.

## Recommended: Vercel frontend + Cloudflare signaling

### 1. Prepare signaling

`worker/wrangler.production.jsonc` defines the production Worker, room Durable Object, SQLite migration, rate limiter, and sampled logs/traces. It contains no account IDs, credentials, or production domains. Set `vars.ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins (for example `https://rooms.example.com`). Include localhost only if intentionally allowing it. Avoid a wildcard or broad Vercel preview-domain allowance; add specific trusted preview origins when needed.

Verify before deployment:

```sh
pnpm install --frozen-lockfile
pnpm --filter worker typegen
pnpm --filter worker typecheck
pnpm --filter worker dry-run:production
```

Once ready to deploy, confirm the intended Cloudflare account with `pnpm --filter worker exec wrangler whoami`, then run `pnpm --filter worker deploy:production`. The migration creates a SQLite-backed namespace for the room class. The returned HTTPS Worker URL becomes `VITE_SIGNALLING_SERVER_URL`. `/health` is a public liveness endpoint.

The Worker rate-limits connection/configuration requests per IP and signaling messages per socket. Socket attachments retain session identity and limits across hibernation. Rooms have two admitted participants; unjoined sockets are bounded and expired. Production logs sample platform events and do not intentionally log SDP, ICE candidates, names, or TURN secrets.

### 2. Configure TURN

TURN is currently disabled to avoid metered relay usage. Re-enabling it requires explicit approval, setting `TURN_ENABLED` to `true` in the production configuration, and deploying it along with valid secrets.

To configure TURN when approved, create a Cloudflare Realtime TURN key in the intended account. Store the key ID and its API token **only in backend secrets**:

```sh
pnpm --filter worker exec wrangler secret put TURN_KEY_ID --config wrangler.production.jsonc
pnpm --filter worker exec wrangler secret put TURN_API_TOKEN --config wrangler.production.jsonc
```

Alternatively, save the two values in ignored `worker/.secrets.production.json`, restrict its file permissions, and upload with:

```sh
chmod 600 worker/.secrets.production.json
pnpm --filter worker exec wrangler secret bulk .secrets.production.json --config wrangler.production.jsonc
```

These commands prompt for values or read the protected file; do not put secrets in shell arguments or frontend environment variables. They modify the deployed Worker and belong to the deployment step. For local Workers use ignored `worker/.dev.vars`; for Node use ignored `server/.env`.

The `/ice` endpoint generates credentials with a one-hour TTL and returns `Cache-Control: no-store`. It checks exact origins and is rate-limited. This prevents casual browser embedding; it is not an authentication boundary against a custom HTTP client. Monitor TURN usage and keep issuance limited for a public demo. TURN bandwidth is a separate cost from signaling.

Credentials currently last one hour. Existing relay allocations and provider behavior can affect longer calls; before promising long sessions, add periodic credential refresh with `setConfiguration` and test reconnects beyond the TTL. No API token is sent to the browser.

### 3. Prepare the frontend on Vercel

- Import this repository.
- Select **Vite** and set the root directory to **`frontend`**.
- Enable inclusion of source files outside the root directory, since the frontend imports `shared/`.
- Install from the workspace root with `cd .. && pnpm install --frozen-lockfile` if Vercel does not detect the pnpm workspace automatically.
- Build with `pnpm build`; output directory: `dist`.
- Set `VITE_SIGNALLING_SERVER_URL` to the signaling service’s HTTPS URL.
- `frontend/vercel.json` handles SPA deep links and basic response security headers.

Confirm that frontend origin is present in the backend allowlist. Verify opening an invitation URL directly, two-person calls, leaving/rejoining, native screen-share stop, denied permissions, and a mobile network using TURN.

For a personal noncommercial demo, target Vercel Hobby and Cloudflare Workers Free within their quotas. Workers Static Assets is an alternative if you later want one hosting provider. Prices and quotas can change: check the linked official pages before enabling paid usage.

## Alternative: Google Cloud Run signaling

Build `docker/Dockerfile.server` with the **repository root** as build context. It listens on `PORT` (container default 3000); Cloud Run injects its own port. Configure exact `ALLOWED_ORIGINS`, optional TURN secrets, and HTTPS access.

For this in-memory adapter:

- Minimum instances: **0**, maximum instances: **1**.
- Allow sufficient concurrency for simultaneous WebSocket requests.
- Increase request timeout up to **3600 seconds** and retain client reconnection.
- Do not add Redis or a database for a tiny single-instance demo. If scaling out, first implement shared room coordination; session affinity alone is insufficient.
- Budget for cold starts, open WebSocket time, image/build storage, and optional TURN traffic. A single open socket keeps the instance active.

## Optional Docker local preview

```sh
docker compose up --build
```

Frontend: `http://localhost:5173`. Signaling: `http://localhost:3001`. Docker uses the same root lockfile and production builds. Configure `ALLOWED_ORIGINS` and `VITE_SIGNALLING_SERVER_URL` for hosted use; frontend environment values are compiled into its assets.

## Official references

- [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)
- [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

## Hosted validation

```sh
pnpm test:production
```

These tests target the live app and signaling service, create temporary rooms, and close their own sockets afterward. They cover deep links, response headers, exact origins, real video playback between isolated browser contexts, media controls, room capacity, and peer replacement. A separate relay-only call is skipped until TURN is configured; when configured, it verifies that both peers actually use TURN. The relay test consumes a small amount of metered bandwidth. CI continues to use local runtimes and does not run production tests automatically.

Override `LIVEROOMS_BASE_URL` and `LIVEROOMS_SIGNALING_URL` for a different deployed environment. Browser media in automated tests is synthetic; real-device and cross-browser acceptance testing remains a separate check.
