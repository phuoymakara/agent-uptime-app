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
- `checker.ts` — `performCheck` dispatches to `checkHttp` (global `fetch`) or `checkTcp` (`cloudflare:sockets` `connect()`). HTTP treats status ≥ 400 as down. TCP waits for `socket.opened` to resolve.
- `logger.ts` — `createLogger(region)` factory. Returns a log object with `info`, `request`, `result`, `error` methods. Every line is prefixed `[ISO timestamp] [region] [LEVEL]`. Called per-request since `region` comes from `c.env`.
- `types.ts` — `CheckRequest`, `CheckResult`, and the `Env` type (CF Workers `Bindings`).

### Environment / bindings

| Name | Kind | Default | Description |
|---|---|---|---|
| `AGENT_TOKENS` | Secret | — | Comma-separated bearer tokens; set via `wrangler secret put AGENT_TOKENS` |
| `AGENT_REGION` | `[vars]` | `sin` | Human label included in logs and `/health`; override in `wrangler.toml` per deployment |

### Multi-region strategy

Deploy the same Worker to multiple CF accounts/zones (or use [Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/)) — each instance just has a different `AGENT_REGION` var and a different Worker name in `wrangler.toml`.

### Non-CF deployment (legacy)

`Dockerfile`, `fly.toml`, and `deploy/` Docker Compose files are kept for VPS / Fly.io deployments. For Node.js, restore `@hono/node-server` and the `serve(...)` call in `index.ts`.
