# Deployment Guide

Multi-region deployment of `uptime-agent` across three cloud platforms.

| Platform | Region | Datacenter |
|----------|--------|------------|
| Render | Australia | Sydney |
| Railway | Asia | Singapore |
| Appwrite | Europe | Frankfurt |

---

## Auto-Deploy on Push to `main`

| Platform | Auto-deploy | How |
|----------|-------------|-----|
| Render | Yes (built-in) | Triggered automatically once repo is connected via Blueprint |
| Railway | Yes (built-in) | Triggered automatically once repo is connected to the project |
| Appwrite | No (needs CI) | A GitHub Actions workflow is included — see below |

Render and Railway watch your connected repo and redeploy whenever `main` changes — no extra setup needed.

Appwrite has no built-in CD. The workflow at `.github/workflows/deploy-appwrite.yml` handles it: it runs `appwrite deploy function` automatically whenever files under `deploy/appwrite/` change on `main`.

### Setting up the Appwrite GitHub Action

Add these two secrets to your GitHub repo (**Settings → Secrets and variables → Actions**):

| Secret | Where to get it |
|--------|----------------|
| `APPWRITE_PROJECT_ID` | Appwrite Console → Project Settings |
| `APPWRITE_API_KEY` | Appwrite Console → Overview → Integrate with your server → API Key (needs `functions.write` scope) |

Once set, any push to `main` that touches `deploy/appwrite/**` will automatically redeploy the function to Frankfurt.

---

## Prerequisites

All platforms use the same Docker image built from the root `Dockerfile`. Before deploying to any platform, make sure you have:

- A bearer token string for `AGENT_TOKENS` (e.g. `gdt-au-1,gdt-au-2`)
- The repo pushed to GitHub or GitLab (required by Render and Railway)

---

## Render — Australia (Sydney)

**Config file:** `render.yaml` (repo root)

### Steps

1. Go to [render.com](https://render.com) and sign in.
2. Click **New → Blueprint** and connect your GitHub/GitLab repo.
3. Render will detect `render.yaml` automatically and pre-fill the service.
4. Open the service → **Environment** tab → add the secret variable:

   | Key | Value |
   |-----|-------|
   | `AGENT_TOKENS` | `your-secret-token-1,your-secret-token-2` |

5. Click **Apply** to trigger the first deploy.

### What the config does

```yaml
region: sydney          # Australia (Sydney) datacenter
plan: starter           # smallest paid plan — always-on, no spin-down
healthCheckPath: /health
envVars:
  AGENT_REGION: australia-sydney   # shown in /health and logs
  PORT: "3001"
  AGENT_TOKENS: <secret>           # set in dashboard, not in file
```

### Verify

```bash
curl https://<your-render-app>.onrender.com/health
# → {"ok":true,"region":"australia-sydney","version":"1.0.0"}
```

---

## Railway — Asia (Singapore)

**Config file:** `railway.toml` (repo root)

### Steps

1. Install the Railway CLI:

   ```bash
   npm install -g @railway/cli
   ```

2. Login and create a new project:

   ```bash
   railway login
   railway init
   ```

3. Set the region to Singapore:

   ```bash
   railway service update --region asia-southeast1
   ```

   > Alternatively: Dashboard → Service → **Settings** → **Deploy** → **Region** → Singapore (`asia-southeast1`).

4. Set the secret token:

   ```bash
   railway variables set AGENT_TOKENS=your-secret-token-1,your-secret-token-2
   ```

5. Deploy:

   ```bash
   railway up
   ```

### What the config does

```toml
[build]
builder = "DOCKERFILE"          # uses root Dockerfile

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5

[deploy.environmentVariables]
AGENT_REGION = "asia-singapore"
PORT = "3001"
# AGENT_TOKENS → set via CLI, not committed here
```

> **Note:** Region is not configurable inside `railway.toml`. It must be set via the CLI command or the Railway dashboard as shown above.

### Verify

```bash
curl https://<your-railway-app>.railway.app/health
# → {"ok":true,"region":"asia-singapore","version":"1.0.0"}
```

---

## Appwrite — Europe (Frankfurt)

**Config directory:** `deploy/appwrite/`

```
deploy/appwrite/
├── appwrite.json                          # Appwrite CLI project config
└── functions/
    └── uptime-agent/
        ├── package.json
        └── src/
            └── main.js                    # Function entry point (ES module)
```

Unlike Render and Railway, this runs as an **Appwrite Function** (serverless, Node.js 21) rather than a long-running container. The Frankfurt region is chosen at project creation time in Appwrite Cloud.

### Steps

1. Go to [cloud.appwrite.io](https://cloud.appwrite.io) and create a new project.
   - When prompted for a region, select **Frankfurt (EU)**.

2. Copy your **Project ID** from the Appwrite Console (visible in Project Settings).

3. Open `deploy/appwrite/appwrite.json` and fill in your project ID:

   ```json
   {
     "projectId": "<YOUR_PROJECT_ID>",
     ...
   }
   ```

4. Install the Appwrite CLI:

   ```bash
   npm install -g appwrite-cli
   ```

5. Login:

   ```bash
   appwrite login
   ```

6. Deploy the function:

   ```bash
   cd deploy/appwrite
   appwrite deploy function
   ```

7. Set environment variables in the Appwrite Console:
   - Navigate to **Functions → uptime-agent → Settings → Variables**
   - Add the following:

   | Key | Value |
   |-----|-------|
   | `AGENT_TOKENS` | `your-secret-token-1,your-secret-token-2` |
   | `AGENT_REGION` | `europe-frankfurt` |

8. Go to **Functions → uptime-agent → Settings** and enable **Execute access** for `any` (or restrict to specific roles as needed).

### How the function works

`src/main.js` is a self-contained ES module that replicates the core logic from `src/checker.ts` and `src/auth.ts` — without Hono — to fit Appwrite's function runtime:

```
GET  /  → health probe  (no auth required)
POST /  → run a check   (Bearer token required)
```

Request body (POST):

```json
{
  "type": "http",
  "url": "https://example.com",
  "timeout": 10000
}
```

Response:

```json
{
  "status": "up",
  "responseTime": 142,
  "statusCode": 200,
  "message": "200 OK"
}
```

### Verify

Use the **Execute** button in the Appwrite Console, or call the function URL directly:

```bash
# Health check (GET)
curl https://<region>.appwrite.run/<project-id>/functions/uptime-agent/executions

# Check endpoint (POST)
curl -X POST https://<function-url> \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"http","url":"https://example.com"}'
```

---

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `AGENT_TOKENS` | Comma-separated bearer tokens. Keep secret — never commit. | `gdt-1,gdt-2` |
| `AGENT_REGION` | Region label returned by `/health` and written to logs. | `australia-sydney` |
| `PORT` | HTTP port the server listens on. Injected automatically by Render and Railway. | `3001` |

---

## All Platforms at a Glance

```
Render  (Sydney)      → render.yaml        → Docker web service, always-on
Railway (Singapore)   → railway.toml       → Docker service, restart on failure
Appwrite (Frankfurt)  → deploy/appwrite/   → Serverless function, Node.js 21
```
