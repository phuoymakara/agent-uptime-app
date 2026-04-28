# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
yarn dev            # Local dev server via wrangler dev (hot-reload)
yarn typecheck      # TypeScript type check (no emit)

# Deployment
yarn deploy         # Deploy to Cloudflare Workers (wrangler deploy)
yarn cf-typegen     # Regenerate CF Workers type bindings (wrangler types)

# First-time secret setup
wrangler secret put AGENT_TOKENS   # Comma-separated bearer tokens
```

There are no automated tests.

## Cloudflare Worker deployment lifecycle

### How CF Workers run

Workers run in **V8 isolates** (not containers). There is no OS process, no cold-start boot — an isolate is created in < 5 ms on first request and reused for subsequent requests on the same edge node. Each `yarn deploy` produces a new **Worker version** that Cloudflare distributes across its ~300 edge locations.

### What happens on `yarn deploy`

```
wrangler bundles src/ (esbuild)  →  uploads bundle to CF API
  →  CF compiles to V8 bytecode  →  new version activated globally (~30 s propagation)
```

In-flight requests on the old version finish normally. New requests are routed to the new version once activated. There is no restart and no downtime.

### Update workflow

```bash
# 1. Develop locally (miniflare — same V8 isolate environment, no CF account needed)
yarn dev

# 2. Type-check before pushing
yarn typecheck

# 3. Deploy — atomic, instant cutover
yarn deploy
```

### What does and doesn't require a redeploy

| Change | Requires redeploy? |
|---|---|
| `src/` code changes | Yes — `yarn deploy` |
| `wrangler.toml` `[vars]` (e.g. `AGENT_REGION`) | Yes — vars are baked into the deployment |
| Secrets (`AGENT_TOKENS`) | **No** — `wrangler secret put` takes effect immediately |

### Rollback

Every `yarn deploy` creates a versioned snapshot. To revert:

```bash
wrangler deployments list                  # find the deployment ID
wrangler rollback <deployment-id>          # instantly activates that version
```

Or use the Cloudflare dashboard: **Workers & Pages → uptime-agent → Deployments → Rollback**.

## Architecture

This is a **stateless uptime-check agent** deployed as a Cloudflare Worker. The central Nuxt uptime-monitor API calls it over HTTP to run a probe from that Worker's region and returns the result.

```
Central API  ──POST /check──►  Cloudflare Worker (this service)
                                   │
                                   ├─ auth middleware validates Bearer token
                                   ├─ checker.ts runs HTTP or TCP probe
                                   └─ returns CheckResult JSON
```

### Source files (`src/`)

- `index.ts` — Hono app. Two routes: `GET /health` (public) and `POST /check` (auth-guarded). Reads `AGENT_REGION` from `c.env`. Exports `default app` for the CF Workers runtime.
- `auth.ts` — Hono middleware typed to `Env`. Validates `Authorization: Bearer <token>` against the `AGENT_TOKENS` binding (comma-separated secrets set via `wrangler secret put`).
- `checker.ts` — `performCheck` dispatches to `checkHttp` (global `fetch`) or `checkTcp` (`cloudflare:sockets` `connect()`). HTTP treats status ≥ 400 as down. TCP waits for `socket.opened` to resolve. **Note:** `ping` is accepted as a valid type by the route but routes to `checkHttp` — it is not an ICMP ping.
- `logger.ts` — `createLogger(region)` factory. Returns a log object with `info`, `request`, `result`, `error` methods. Every line is prefixed `[ISO timestamp] [region] [LEVEL]`. Called per-request since `region` comes from `c.env`.
- `types.ts` — `CheckRequest`, `CheckResult`, and the `Env` type (CF Workers `Bindings`).

### Environment / bindings

| Name | Kind | Default | Description |
|---|---|---|---|
| `AGENT_TOKENS` | Secret | — | Comma-separated bearer tokens; set via `wrangler secret put AGENT_TOKENS` |
| `AGENT_REGION` | `[vars]` | `sin` | Human label included in logs and `/health`; override in `wrangler.toml` per deployment |

### Multi-region strategy

Deploy the same Worker to multiple CF accounts/zones (or use [Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/)) — each instance just has a different `AGENT_REGION` var and a different Worker name in `wrangler.toml`.

### Request / response contract

`POST /check` body (`CheckRequest`):
```json
{ "type": "http" | "tcp" | "ping", "url": "https://…" | "tcp://host:port", "timeout": 10000 }
```
TCP checker strips the `tcp://` prefix and parses `host:port` using `lastIndexOf(':')` (IPv6-safe).

Response (`CheckResult`):
```json
{ "status": "up" | "down", "responseTime": 123, "statusCode": 200, "message": "200 OK" }
```
`statusCode` is omitted for TCP checks.

### Non-CF deployment (legacy)

`Dockerfile`, `fly.toml`, and `deploy/` Docker Compose files are kept for VPS / Fly.io deployments. Before using the Dockerfile, add `@hono/node-server`, restore the `serve(...)` call in `index.ts`, and add a `build` script (`tsc`) to `package.json` — `yarn build` is referenced in the Dockerfile but does not exist in the current scripts.
