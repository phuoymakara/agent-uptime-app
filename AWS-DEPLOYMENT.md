# Uptime Agent — AWS Lambda Deployment Guide

> **Stack:** Node.js 22 · Hono · AWS Lambda (arm64) · API Gateway HTTP API · AWS SAM  
> **Active regions:** Singapore (`ap-southeast-1`) · Sydney (`ap-southeast-2`)  
> **Planned regions:** Frankfurt (`eu-central-1`) · Virginia (`us-east-1`)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
   - [Create an AWS Account](#21-create-an-aws-account)
   - [Install Local Tools](#22-install-local-tools)
   - [Configure AWS CLI](#23-configure-aws-cli)
3. [Project Structure Changes](#3-project-structure-changes)
4. [Build Process](#4-build-process)
5. [First-Time Infrastructure Setup](#5-first-time-infrastructure-setup)
6. [Deployment](#6-deployment)
   - [Automated — CI/CD via GitHub Actions](#61-automated--cicd-via-github-actions)
   - [Manual Deploy](#62-manual-deploy)
7. [Public URLs & Multi-Region Routing](#7-public-urls--multi-region-routing)
   - [What URL you get out of the box](#70-what-url-do-you-get-out-of-the-box)
   - [Custom Domain Setup](#71-custom-domain-setup)
   - [Route 53 Latency Routing](#72-multi-region-routing-with-route-53)
8. [Environment Promotion (Staging → Production)](#8-environment-promotion-staging--production)
9. [Observability](#9-observability)
10. [Security](#10-security)
11. [Cost Estimation](#11-cost-estimation)
12. [Performance & Cold Starts](#12-performance--cold-starts)
13. [Rollback](#13-rollback)
14. [Local Development & Lambda Testing](#14-local-development--lambda-testing)
15. [Adding a New Region](#15-adding-a-new-region)
16. [Notes for Future Developers](#16-notes-for-future-developers)

---

## 1. Architecture Overview

```
                          ┌─────────────────────────────────┐
                          │        Route 53 (DNS)           │
                          │  agent.yourdomain.com           │
                          │  Latency-based routing          │
                          └────────────┬────────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                                         │
         ┌────────▼─────────┐                   ┌──────────▼────────┐
         │  API Gateway     │                   │  API Gateway      │
         │  HTTP API        │                   │  HTTP API         │
         │  ap-southeast-1  │                   │  ap-southeast-2   │
         └────────┬─────────┘                   └──────────┬────────┘
                  │                                         │
         ┌────────▼─────────┐                   ┌──────────▼────────┐
         │  Lambda Function │                   │  Lambda Function  │
         │  uptime-agent    │                   │  uptime-agent     │
         │  singapore       │                   │  sydney           │
         │  arm64 / 256 MB  │                   │  arm64 / 256 MB   │
         └────────┬─────────┘                   └──────────┬────────┘
                  │                                         │
         ┌────────▼─────────┐                   ┌──────────▼────────┐
         │  CloudWatch Logs │                   │  CloudWatch Logs  │
         │  + Alarms        │                   │  + Alarms         │
         └──────────────────┘                   └───────────────────┘
```

### How it works

| Component | Role |
|-----------|------|
| **Lambda (arm64)** | Runs the Hono app. Stateless — scales from 0 to thousands of concurrent checks automatically. |
| **API Gateway HTTP API** | Lightweight, low-latency gateway (~1ms overhead). Routes all HTTP traffic to Lambda. |
| **AWS SAM** | Infrastructure-as-code. Each region is an independent CloudFormation stack. |
| **Route 53 latency routing** | Routes callers to the nearest healthy region based on AWS latency measurements. |
| **CloudWatch** | Logs, error-rate alarms, and P95 latency alarms per region. |

### Why Lambda (not containers or VMs)?

- **Zero idle cost** — you only pay per request (see [Cost Estimation](#11-cost-estimation))
- **Auto-scaling** — no capacity planning; handles burst traffic without configuration
- **Multi-region is trivial** — deploy the same SAM stack to each region independently
- **Hono is perfect for Lambda** — tiny runtime, no heavy framework overhead, first response < 5ms

---

## 2. Prerequisites

### 2.1 Create an AWS Account

> Skip this section if you already have an AWS account and an IAM user with access keys.

#### Step 1 — Sign up

1. Go to [aws.amazon.com](https://aws.amazon.com) and click **Create an AWS Account**
2. Enter your email address and choose an account name (e.g. `tsc-uptime`)
3. Choose **Root user email** and create a strong password
4. Select **Personal** or **Business** account type and fill in contact details
5. Enter a credit/debit card — AWS needs this even for free-tier usage. You won't be charged unless you exceed free-tier limits
6. Verify your phone number via SMS or voice call
7. Choose the **Basic support plan** (free)
8. Click **Complete sign up** — you'll receive a confirmation email

> The email and password you just used are your **root account** credentials. Guard them carefully — never use them for day-to-day work.

---

#### Step 2 — Secure the root account with MFA

Never use the root account for deployments. First, lock it down with MFA:

1. Sign in to the [AWS Console](https://console.aws.amazon.com) with your root email and password
2. Click your account name (top-right) → **Security credentials**
3. Under **Multi-factor authentication (MFA)**, click **Assign MFA device**
4. Choose **Authenticator app**, scan the QR code with Google Authenticator or Authy
5. Enter two consecutive codes to confirm, then click **Add MFA**

---

#### Step 3 — Create an IAM user for deployments

The IAM user is what you (and CI/CD) will use to deploy. Never deploy using root credentials.

1. In the AWS Console, search for **IAM** and open it
2. In the left sidebar click **Users** → **Create user**
3. Set the username to `uptime-agent-deployer` (or similar) and click **Next**
4. Select **Attach policies directly**
5. Search for and tick each of these managed policies:

   | Policy | Why it's needed |
   |--------|----------------|
   | `AWSLambda_FullAccess` | Create and update Lambda functions |
   | `AmazonAPIGatewayAdministrator` | Create and manage API Gateway HTTP APIs |
   | `AWSCloudFormationFullAccess` | SAM uses CloudFormation to manage stacks |
   | `IAMFullAccess` | SAM creates an execution role for Lambda |
   | `AmazonS3FullAccess` | SAM uploads the Lambda bundle to S3 |

6. Click **Next** → **Create user**

> `IAMFullAccess` is broad. Once you're comfortable with the setup, replace it with a scoped-down policy. See [Security](#10-security) for the minimal version.

---

#### Step 4 — Create access keys for the IAM user

1. Open the user you just created (**IAM → Users → uptime-agent-deployer**)
2. Click the **Security credentials** tab
3. Under **Access keys**, click **Create access key**
4. Select **Command Line Interface (CLI)** as the use case
5. Tick the confirmation checkbox and click **Next**
6. Click **Create access key**
7. **Download the `.csv` file** or copy both values now — the secret key is shown only once

```
Access key ID:     AKIAIOSFODNN7EXAMPLE
Secret access key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

---

#### Step 5 — Enable MFA on the IAM user (recommended)

Same process as root MFA — adds a second layer if credentials are ever leaked:

1. On the IAM user's **Security credentials** tab, click **Assign MFA device**
2. Follow the same authenticator-app flow as Step 2

---

#### Step 6 — Set a billing alert

Catch unexpected charges before they grow:

1. In the AWS Console, search for **Billing** → **Billing preferences**
2. Under **Alert preferences**, enable **AWS Free Tier alerts** and **CloudWatch billing alerts**
3. Enter your email and save

Then create a $10 alert (see [Cost Estimation](#11-cost-estimation) for the full command).

---

### 2.2 Install Local Tools

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22.x | [nodejs.org](https://nodejs.org) |
| Yarn | 1.x | `npm i -g yarn` |
| AWS CLI v2 | latest | [docs.aws.amazon.com/cli](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| AWS SAM CLI | latest | [docs.aws.amazon.com/serverless-application-model](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) |

**Verify installs:**

```bash
node --version      # v22.x.x
aws --version       # aws-cli/2.x.x
sam --version       # SAM CLI, version 1.x.x
```

---

### 2.3 Configure AWS CLI

Run this once with the access key from Step 4 above:

```bash
aws configure
# AWS Access Key ID:     AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region:        ap-southeast-1
# Default output format: json
```

Verify it works:

```bash
aws sts get-caller-identity
# {
#   "UserId": "AIDAIOSFODNN7EXAMPLE",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/uptime-agent-deployer"
# }
```

If you see your account ID and ARN, you're ready to deploy.

---

## 3. Project Structure Changes

The app was refactored to separate the Hono application from its runtime entry point, enabling both local Node.js server and Lambda deployments from the same codebase.

```
src/
├── app.ts        ← Hono app + all routes (shared)
├── index.ts      ← Local server entry (Node.js / Docker)
├── lambda.ts     ← Lambda entry point (AWS)
├── auth.ts
├── checker.ts
├── logger.ts
└── types.ts
```

**`src/lambda.ts`** is the only Lambda-specific file:

```typescript
import { handle } from 'hono/aws-lambda'
import app from './app'

export const handler = handle(app)
```

`hono/aws-lambda` translates API Gateway events ↔ standard Fetch API requests/responses so the Hono app needs zero changes.

---

## 4. Build Process

### Local / Docker build (unchanged)

```bash
yarn build      # tsc → dist/*.js
yarn start      # node dist/index.js
```

### Lambda build

```bash
yarn build:lambda
# esbuild bundles src/lambda.ts + all imports into dist/lambda.js
# Single file, ~200KB, no node_modules directory needed
```

`esbuild` is used instead of `tsc` for Lambda because:
- Produces a **single bundled file** — SAM only uploads `dist/lambda.js`, not `node_modules/`
- **3-5× faster** than tsc for bundling
- Output is already minified for faster cold starts

The SAM template's `CodeUri: dist/` points to this output directory.

---

## 5. First-Time Infrastructure Setup

Run this **once per region** to create the S3 bucket SAM uses for artifacts and bootstrap the CloudFormation stack.

### Singapore

```bash
# 1. Run guided deploy (interactive, creates samconfig S3 bucket)
sam deploy --guided \
  --config-env singapore \
  --parameter-overrides "AgentRegion=singapore AgentTokens=your-token-here"

# When prompted:
#   Stack name: uptime-agent-singapore
#   Region: ap-southeast-1
#   Save to samconfig.toml: Y
```

### Sydney

```bash
sam deploy --guided \
  --config-env sydney \
  --parameter-overrides "AgentRegion=sydney AgentTokens=your-token-here"

# When prompted:
#   Stack name: uptime-agent-sydney
#   Region: ap-southeast-2
```

After first-time setup, `samconfig.toml` will have the S3 bucket name filled in automatically. Subsequent deploys are non-interactive.

---

## 6. Deployment

### 6.1 Automated — CI/CD via GitHub Actions

**File:** `.github/workflows/deploy.yml`  
**Full setup guide:** [`CI-CD-SETUP.md`](CI-CD-SETUP.md)

#### Trigger

| Event | Behaviour |
|-------|-----------|
| Push to `main` | Deploys all regions automatically |
| `workflow_dispatch` | Manual trigger — choose region and environment |

#### Pipeline stages

```
build → [deploy-singapore, deploy-sydney] → notify
         (parallel)
```

The build stage runs once and uploads `dist/` as an artifact shared by all region deploy jobs. This avoids rebuilding for each region.

Each deploy job:
1. Downloads the shared `dist/` artifact
2. Assumes an IAM role via **GitHub OIDC** (no long-lived keys stored)
3. Runs `sam deploy` with the region-specific config
4. Runs a smoke test against the live `/health` endpoint

#### GitHub Secrets to configure

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | ARN of the IAM role GitHub Actions assumes via OIDC |
| `AGENT_TOKENS` | Comma-separated bearer tokens (e.g. `tok1,tok2`) |

#### GitHub Environments

Create two environments under **Settings → Environments**:
- `singapore` — optionally add required reviewers for production protection
- `sydney`

#### Deployment flow diagram

```
git push main
      │
      ▼
   [Build]
   yarn install
   yarn build:lambda
   upload dist/ artifact
      │
      ├─────────────────────────────┐
      ▼                             ▼
[Deploy Singapore]           [Deploy Sydney]
assume IAM role (OIDC)       assume IAM role (OIDC)
sam deploy --config-env      sam deploy --config-env
singapore                    sydney
curl /health smoke test      curl /health smoke test
      │                             │
      └─────────────┬───────────────┘
                    ▼
               [Notify]
           print summary / fail
```

> See [`CI-CD-SETUP.md`](CI-CD-SETUP.md) for the step-by-step instructions to create the OIDC provider, IAM role, and GitHub secrets.

---

### 6.2 Manual Deploy

```bash
# Set your tokens
export AGENT_TOKENS="token1,token2"

# Deploy one region
./scripts/deploy.sh singapore
./scripts/deploy.sh sydney

# Deploy all regions
./scripts/deploy.sh all
```

The script builds, deploys, and runs a smoke test against `/health` automatically.

**Windows (PowerShell):**

```powershell
$env:AGENT_TOKENS = "token1,token2"
bash scripts/deploy.sh singapore   # use Git Bash or WSL
```

---

## 7. Public URLs & Multi-Region Routing

### 7.0 What URL do you get out of the box?

The moment `sam deploy` finishes, API Gateway generates a live public URL — no extra config needed:

```
https://<random-id>.execute-api.ap-southeast-1.amazonaws.com   ← Singapore
https://<random-id>.execute-api.ap-southeast-2.amazonaws.com   ← Sydney
```

These are immediately usable. The smoke test in the deploy script already hits `/health` on these URLs to confirm they're working.

The `random-id` part is stable — it doesn't change between deploys of the same stack.

### Do you need a custom domain?

| Situation | Recommendation |
|-----------|---------------|
| Internal tool, called only by your own systems | Raw API Gateway URL is fine |
| You want a stable, readable URL | Custom domain recommended |
| Multi-region unified endpoint (`agent.yourdomain.com`) | Custom domain + Route 53 required |

---

### 7.1 Custom Domain Setup

#### Step A — Request an ACM certificate

The certificate must be in the **same region** as the API Gateway it will serve.

```bash
# Singapore
aws acm request-certificate \
  --domain-name "agent.yourdomain.com" \
  --subject-alternative-names "*.agent.yourdomain.com" \
  --validation-method DNS \
  --region ap-southeast-1

# Sydney
aws acm request-certificate \
  --domain-name "agent.yourdomain.com" \
  --subject-alternative-names "*.agent.yourdomain.com" \
  --validation-method DNS \
  --region ap-southeast-2
```

After running each command, AWS returns a CNAME record you must add to your DNS to prove domain ownership. Add it in Route 53 (or your registrar) and wait for status to become `ISSUED` (~2 minutes with Route 53, up to 30 min with external DNS).

```bash
# Check certificate status
aws acm describe-certificate \
  --certificate-arn <arn> \
  --region ap-southeast-1 \
  --query "Certificate.Status"
```

#### Step B — Create a custom domain in API Gateway

```bash
# Singapore — creates the regional domain endpoint you'll point DNS at
aws apigatewayv2 create-domain-name \
  --domain-name "sg.agent.yourdomain.com" \
  --domain-name-configurations \
    "CertificateArn=arn:aws:acm:ap-southeast-1:ACCOUNT:certificate/xxx,EndpointType=REGIONAL" \
  --region ap-southeast-1

# Sydney
aws apigatewayv2 create-domain-name \
  --domain-name "au.agent.yourdomain.com" \
  --domain-name-configurations \
    "CertificateArn=arn:aws:acm:ap-southeast-2:ACCOUNT:certificate/yyy,EndpointType=REGIONAL" \
  --region ap-southeast-2
```

Each command returns an `ApiGatewayDomainName` — a regional hostname that looks like:

```
d-xxxxxx.execute-api.ap-southeast-1.amazonaws.com   ← point sg.agent.yourdomain.com here
d-yyyyyy.execute-api.ap-southeast-2.amazonaws.com   ← point au.agent.yourdomain.com here
```

#### Step C — Map the domain to your API stage

```bash
# Get your API ID first
aws apigatewayv2 get-apis --region ap-southeast-1 \
  --query "Items[?Name=='uptime-agent-singapore'].ApiId" --output text

# Map the custom domain → API stage
aws apigatewayv2 create-api-mapping \
  --domain-name "sg.agent.yourdomain.com" \
  --api-id <api-id> \
  --stage '$default' \
  --region ap-southeast-1

# Repeat for Sydney
aws apigatewayv2 create-api-mapping \
  --domain-name "au.agent.yourdomain.com" \
  --api-id <api-id> \
  --stage '$default' \
  --region ap-southeast-2
```

#### Step D — DNS records

In Route 53 (or your registrar), create ALIAS records for the per-region subdomains:

| Record | Type | Value |
|--------|------|-------|
| `sg.agent.yourdomain.com` | ALIAS | `d-xxxxxx.execute-api.ap-southeast-1.amazonaws.com` |
| `au.agent.yourdomain.com` | ALIAS | `d-yyyyyy.execute-api.ap-southeast-2.amazonaws.com` |

Use `ALIAS` (not `CNAME`) when the target is an AWS service — ALIAS records are free and resolve faster.

Test immediately after DNS propagates:

```bash
curl https://sg.agent.yourdomain.com/health
curl https://au.agent.yourdomain.com/health
```

---

### 7.2 Multi-Region Routing with Route 53

Route 53 latency-based routing sends each caller to whichever region has the lowest measured latency from their network location.

### Step 1 — Get your API Gateway endpoints

After deploying each region, retrieve the endpoint URLs:

```bash
# Singapore
aws cloudformation describe-stacks \
  --stack-name uptime-agent-singapore \
  --region ap-southeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text

# Sydney
aws cloudformation describe-stacks \
  --stack-name uptime-agent-sydney \
  --region ap-southeast-2 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text
```

Endpoints look like:
```
https://abc123.execute-api.ap-southeast-1.amazonaws.com
https://xyz789.execute-api.ap-southeast-2.amazonaws.com
```

### Step 2 — Configure Route 53

In **Route 53 → Hosted zones → yourdomain.com**, create:

#### A. Per-region CNAME records (direct access)

| Record | Type | Value |
|--------|------|-------|
| `sg.agent.yourdomain.com` | CNAME | `abc123.execute-api.ap-southeast-1.amazonaws.com` |
| `au.agent.yourdomain.com` | CNAME | `xyz789.execute-api.ap-southeast-2.amazonaws.com` |

These give you fixed, region-specific endpoints — useful for debugging or pinning a monitor to a specific region.

#### B. Latency-based routing record (unified endpoint)

Create **two records** with the **same name** `agent.yourdomain.com`:

| Name | Type | Routing | Region | Value |
|------|------|---------|--------|-------|
| `agent.yourdomain.com` | CNAME | Latency | ap-southeast-1 | `sg.agent.yourdomain.com` |
| `agent.yourdomain.com` | CNAME | Latency | ap-southeast-2 | `au.agent.yourdomain.com` |

Route 53 automatically returns the record from the AWS region the caller is closest to.

#### C. Health checks (optional but recommended)

Add Route 53 health checks to remove unhealthy regions from rotation:

```bash
# Create a health check for Singapore
aws route53 create-health-check \
  --caller-reference "uptime-agent-sg-$(date +%s)" \
  --health-check-config '{
    "Type": "HTTPS",
    "FullyQualifiedDomainName": "abc123.execute-api.ap-southeast-1.amazonaws.com",
    "ResourcePath": "/health",
    "RequestInterval": 30,
    "FailureThreshold": 3
  }'
```

Associate the health check ID with your latency routing records to enable automatic failover.

> Once you have custom domains set up (see [7.1 Custom Domain Setup](#71-custom-domain-setup)), update these Route 53 records to point to your API Gateway regional domain names (`d-xxxxxx.execute-api...`) instead of the raw API Gateway URLs.

---

## 8. Environment Promotion (Staging → Production)

Staging stacks are independent CloudFormation stacks that share nothing with production.

```bash
# Deploy staging
export AGENT_TOKENS="staging-token-1"
sam deploy --config-env singapore-staging \
  --parameter-overrides "AgentTokens=$AGENT_TOKENS"

# Test staging endpoint
STAGING_URL=$(aws cloudformation describe-stacks \
  --stack-name uptime-agent-singapore-staging \
  --region ap-southeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text)

curl -H "Authorization: Bearer staging-token-1" \
  -d '{"type":"http","url":"https://example.com"}' \
  "$STAGING_URL/check"

# Promote to production (re-deploy production stack with same build)
export AGENT_TOKENS="prod-token-1,prod-token-2"
./scripts/deploy.sh singapore
```

---

## 9. Observability

### CloudWatch Logs

Lambda automatically streams all `console.log` output to CloudWatch. The structured logger in `src/logger.ts` tags every line with the region and ISO timestamp.

```bash
# Tail live logs for Singapore
aws logs tail /aws/lambda/uptime-agent-singapore-production \
  --follow \
  --region ap-southeast-1
```

### CloudWatch Alarms

The SAM template creates two alarms per region automatically:

| Alarm | Threshold | Action |
|-------|-----------|--------|
| Error rate | > 5 errors / 5 min | Investigate |
| P95 duration | > 10 seconds | Investigate timeout/network |

To add SNS email notifications to alarms:

```bash
# Create an SNS topic
aws sns create-topic --name uptime-agent-alerts --region ap-southeast-1

# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-southeast-1:ACCOUNT:uptime-agent-alerts \
  --protocol email \
  --notification-endpoint your@email.com \
  --region ap-southeast-1

# Update the alarm to trigger the SNS topic (add AlarmActions to template.yaml)
```

### Lambda Insights (Enhanced Monitoring)

For deeper metrics (memory utilisation, CPU, init duration), enable Lambda Insights:

Add to `template.yaml` under `Globals.Function`:
```yaml
Layers:
  - !Sub "arn:aws:lambda:${AWS::Region}:580247275435:layer:LambdaInsightsExtension-Arm64:20"
Policies:
  - CloudWatchLambdaInsightsExecutionRolePolicy
```

### Useful CloudWatch queries

```
# Error rate over time (Logs Insights)
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() as errors by bin(5m)

# Average response time
fields @timestamp, @duration
| stats avg(@duration) as avg_ms, pct(@duration, 95) as p95_ms by bin(5m)
```

---

## 10. Security

### Token management

`AGENT_TOKENS` is passed as an environment variable. For production, store it in **AWS SSM Parameter Store** as a `SecureString`:

```bash
# Store the token securely
aws ssm put-parameter \
  --name "/uptime-agent/singapore/agent-tokens" \
  --value "prod-token-1,prod-token-2" \
  --type SecureString \
  --region ap-southeast-1

# Lambda can fetch it at startup — update src/app.ts to use the AWS SDK
# or use SAM's built-in SSM parameter resolution in template.yaml:
```

In `template.yaml`, replace the `AgentTokens` parameter with:

```yaml
AgentTokens:
  Type: AWS::SSM::Parameter::Value<String>
  Default: /uptime-agent/singapore/agent-tokens
```

### IAM least privilege

For CI/CD, create a dedicated IAM user with only what's needed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["cloudformation:*"], "Resource": "arn:aws:cloudformation:*:*:stack/uptime-agent-*/*" },
    { "Effect": "Allow", "Action": ["lambda:*"], "Resource": "arn:aws:lambda:*:*:function:uptime-agent-*" },
    { "Effect": "Allow", "Action": ["apigateway:*"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": "arn:aws:s3:::aws-sam-cli-managed-*/*" },
    { "Effect": "Allow", "Action": ["iam:PassRole", "iam:CreateRole", "iam:AttachRolePolicy"], "Resource": "arn:aws:iam::*:role/uptime-agent-*" }
  ]
}
```

### Network

Lambda runs in AWS-managed VPC by default (no inbound attack surface). For outbound isolation, place Lambda in a private VPC subnet and route outbound checks through a NAT Gateway. This is optional for this use case.

---

## 11. Cost Estimation

Uptime checking is extremely light — the dominant cost is invocation count, not duration.

### Assumptions

| Parameter | Value |
|-----------|-------|
| Checks per minute | 60 (one per second) |
| Average duration | 500ms |
| Memory | 256 MB |
| Regions | 2 |

### Monthly estimate (per region)

| Service | Monthly cost |
|---------|-------------|
| Lambda invocations (2.6M/month) | ~$0.05 |
| Lambda compute (GB-seconds) | ~$0.22 |
| API Gateway HTTP API | ~$0.90 |
| CloudWatch Logs (1 GB) | ~$0.50 |
| **Total per region** | **~$1.70** |
| **Two regions total** | **~$3.40** |

Lambda's free tier (1M requests + 400,000 GB-seconds/month) covers the first month at this rate.

> Use the [AWS Pricing Calculator](https://calculator.aws) to get an exact estimate for your check frequency.

### Cost controls

- Set a **AWS Budget alert** at $10/month to catch runaway costs early:
  ```bash
  aws budgets create-budget \
    --account-id $(aws sts get-caller-identity --query Account --output text) \
    --budget '{"BudgetName":"uptime-agent","BudgetType":"COST","BudgetLimit":{"Amount":"10","Unit":"USD"},"TimeUnit":"MONTHLY"}' \
    --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"your@email.com"}]}]'
  ```

---

## 12. Performance & Cold Starts

### Cold start profile

| Metric | Value |
|--------|-------|
| Bundle size | ~200 KB (esbuild) |
| Init duration (cold) | ~150–300ms |
| Execution (warm) | ~5ms + network time |

Hono has negligible startup cost. The `esbuild` bundle keeps initialization time low by avoiding dynamic `require()` chains.

### arm64 (Graviton2) advantage

The SAM template uses `Architectures: [arm64]`. Graviton2 gives:
- **~20% better price/performance** than x86
- Faster cold starts for Node.js
- No code changes needed — Node.js 22 runs natively on arm64

### If cold starts become a problem

Add Provisioned Concurrency to keep one instance always warm (adds ~$2–3/month per region):

```yaml
# In template.yaml
UptimeAgentFunctionAlias:
  Type: AWS::Lambda::Alias
  Properties:
    FunctionName: !Ref UptimeAgentFunction
    FunctionVersion: !GetAtt UptimeAgentFunction.Version
    Name: live
    ProvisionedConcurrencyConfig:
      ProvisionedConcurrentExecutions: 1
```

---

## 13. Rollback

### Automatic rollback (CloudFormation)

CloudFormation rolls back a deploy automatically if the stack update fails. No action needed.

### Manual rollback to previous version

```bash
# List recent Lambda versions
aws lambda list-versions-by-function \
  --function-name uptime-agent-singapore-production \
  --region ap-southeast-1 \
  --query "Versions[-5:].{Version:Version,Modified:LastModified}" \
  --output table

# Point the alias to a previous version
aws lambda update-alias \
  --function-name uptime-agent-singapore-production \
  --name live \
  --function-version 12 \
  --region ap-southeast-1
```

### Rollback via CloudFormation

```bash
# List changesets (find the previous deploy)
aws cloudformation list-stacks \
  --stack-status-filter UPDATE_COMPLETE \
  --region ap-southeast-1

# CloudFormation doesn't support "rollback to version N" directly.
# Re-deploy the previous Git tag instead:
git checkout v1.2.3
yarn build:lambda
./scripts/deploy.sh singapore
```

---

## 14. Local Development & Lambda Testing

### Standard local development (unchanged)

```bash
yarn dev   # tsx watch, hot reload, reads .env
```

### Test the Lambda handler locally with SAM

```bash
# Build first
yarn build:lambda

# Start local API Gateway emulator
sam local start-api --env-vars env.json

# env.json — local override for Lambda env vars
# {
#   "UptimeAgentFunction": {
#     "AGENT_REGION": "local",
#     "AGENT_TOKENS": "test-token"
#   }
# }

# Test endpoints
curl http://localhost:3000/health
curl -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"http","url":"https://example.com","timeout":5000}' \
  http://localhost:3000/check
```

### Invoke a single Lambda event

```bash
# Create a test event
cat > events/check.json <<EOF
{
  "version": "2.0",
  "routeKey": "POST /check",
  "rawPath": "/check",
  "headers": {
    "authorization": "Bearer test-token",
    "content-type": "application/json"
  },
  "body": "{\"type\":\"http\",\"url\":\"https://example.com\"}",
  "isBase64Encoded": false
}
EOF

sam local invoke UptimeAgentFunction \
  --event events/check.json \
  --env-vars env.json
```

---

## 15. Adding a New Region

**Example: Frankfurt (eu-central-1)**

1. **Uncomment the `frankfurt` section in `samconfig.toml`**

2. **Add a deploy job to `.github/workflows/deploy.yml`** (copy the `deploy-sydney` job, update region and config-env)

3. **First-time deploy:**
   ```bash
   export AGENT_TOKENS="your-tokens"
   sam deploy --guided \
     --config-env frankfurt \
     --parameter-overrides "AgentRegion=frankfurt AgentTokens=$AGENT_TOKENS"
   ```

4. **Add Route 53 latency record** for `eu-central-1` pointing to the new endpoint

5. **Add the endpoint to the `workflow_dispatch` input choices** in the deploy workflow

No code changes are required — the same Lambda bundle deploys to any AWS region.

---

## 16. Notes for Future Developers

### Architecture decisions

| Decision | Why |
|----------|-----|
| **Lambda over containers** | Zero idle cost; multi-region is just another `sam deploy` |
| **API Gateway HTTP API over REST API** | ~70% cheaper, lower latency, sufficient features |
| **esbuild over tsc for Lambda** | Single bundled file avoids shipping `node_modules/` |
| **arm64 (Graviton2)** | Better price/performance, no code changes needed |
| **SAM over CDK/Terraform** | Lightweight, single YAML file, official AWS tool, no compilation step |
| **Two entry points (index.ts + lambda.ts)** | Docker/local and Lambda share the same app.ts; only the server binding differs |

### Checklist before deploying a new change

- [ ] `yarn build:lambda` succeeds without errors
- [ ] `sam local start-api` — smoke test `/health` and `/check` locally
- [ ] PR merged to `main` (CI/CD deploys automatically)
- [ ] Check CloudWatch Logs for errors after deploy
- [ ] Verify `/health` returns the expected `region` value for each region

### Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_REGION` | Yes | Human-readable region label shown in API responses and logs |
| `AGENT_TOKENS` | Yes | Comma-separated bearer tokens. Protect carefully. |
| `PORT` | No | Only used by `index.ts` (local/Docker). Lambda ignores it. |

### TCP checks on Lambda

`checker.ts` uses Node.js `net.Socket` for TCP checks. Lambda functions have full outbound internet access by default, so TCP checks to public IPs work without any VPC configuration.

Ping (`ICMP`) checks remain commented out because Lambda does not allow raw socket access. To support ping, route the request through an EC2 instance or use AWS Network Monitor.

### Secrets rotation

When rotating `AGENT_TOKENS`:
1. Add the new token alongside the old one (comma-separated)
2. Deploy to all regions
3. Update callers to use the new token
4. Remove the old token
5. Deploy again

This ensures zero-downtime rotation.
