# CI/CD Pipeline Setup — Uptime Agent

> Automates build and multi-region Lambda deployment whenever code is pushed to `main`.  
> Uses **GitHub Actions + AWS OIDC** — no long-lived IAM keys are stored anywhere.

---

## How the Pipeline Works

```
git push main
      │
      ▼
  [Build]
  yarn install --frozen-lockfile
  yarn build:lambda (esbuild → dist/lambda.js)
  upload dist/ as shared artifact
      │
      ├──────────────────────────────────┐
      ▼                                  ▼
[Deploy Singapore]               [Deploy Sydney]
assume IAM role via OIDC         assume IAM role via OIDC
sam deploy --config-env          sam deploy --config-env
singapore                        sydney
curl /health smoke test          curl /health smoke test
      │                                  │
      └──────────────┬───────────────────┘
                     ▼
                [Notify]
          print summary / fail
```

| Trigger | Behaviour |
|---------|-----------|
| Push to `main` | Builds and deploys to **both** regions in parallel |
| `workflow_dispatch` (Actions tab) | Choose region (`all` / `singapore` / `sydney`) and environment |

---

## One-Time Setup

### Step 1 — Create the GitHub OIDC Provider in AWS

Run once per AWS account (it is a global resource, not per-region):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

This tells AWS to trust GitHub's identity tokens. Without it, `sts:AssumeRoleWithWebIdentity` will fail.

Verify it was created:

```bash
aws iam list-open-id-connect-providers
```

---

### Step 2 — Create the IAM Role for GitHub Actions

Replace the placeholders before running:

| Placeholder | Replace with |
|-------------|--------------|
| `YOUR_ACCOUNT_ID` | Your 12-digit AWS account ID (`aws sts get-caller-identity --query Account --output text`) |
| `YOUR_GITHUB_USER_OR_ORG` | Your GitHub username or organisation (e.g. `mark`) |
| `YOUR_REPO_NAME` | The repository name (e.g. `uptime-agent`) |

```bash
# 1. Write the trust policy
cat > /tmp/trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_USER_OR_ORG/YOUR_REPO_NAME:*"
      }
    }
  }]
}
EOF

# 2. Create the role
aws iam create-role \
  --role-name uptime-agent-github-ci \
  --assume-role-policy-document file:///tmp/trust.json \
  --description "Assumed by GitHub Actions to deploy uptime-agent"

# 3. Attach the deploy permissions (scoped to this project)
aws iam put-role-policy \
  --role-name uptime-agent-github-ci \
  --policy-name uptime-agent-deploy \
  --policy-document file://scripts/iam-ci-policy.json

# 4. Get the role ARN — save this for Step 4
aws iam get-role \
  --role-name uptime-agent-github-ci \
  --query Role.Arn \
  --output text
```

The role ARN looks like:
```
arn:aws:iam::123456789012:role/uptime-agent-github-ci
```

> **Why OIDC instead of access keys?**  
> With OIDC, GitHub mints a short-lived token per workflow run and exchanges it for temporary AWS credentials. There are no long-lived keys to rotate, leak, or expire. The trust condition is scoped to your specific repo — a token from any other repo cannot assume this role.

---

### Step 3 — Create GitHub Environments

In your GitHub repository:  
**Settings → Environments → New environment**

Create these two environments:

| Environment name | Purpose |
|-----------------|---------|
| `singapore` | Production deploy to `ap-southeast-1` |
| `sydney` | Production deploy to `ap-southeast-2` |

Optional: add **Required reviewers** to either environment for a manual approval gate before production deploys.

---

### Step 4 — Add GitHub Secrets

In your GitHub repository:  
**Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value | Where to get it |
|-------------|-------|-----------------|
| `AWS_DEPLOY_ROLE_ARN` | The role ARN from Step 2 | Output of `aws iam get-role ...` |
| `AGENT_TOKENS` | Comma-separated bearer tokens | Your own tokens (e.g. `token1,token2`) |

> `AGENT_TOKENS` is injected as a CloudFormation parameter at deploy time and stored as a Lambda environment variable. Keep it out of your codebase and git history.

---

### Step 5 — Push the Workflow to GitHub

The workflow lives at `.github/workflows/deploy.yml`. Commit and push it:

```bash
git add .github/workflows/deploy.yml scripts/iam-ci-policy.json CI-CD-SETUP.md
git commit -m "ci: add GitHub Actions deploy pipeline with OIDC auth"
git push origin feature/aws-setup
```

Then open a pull request and merge to `main`. The workflow will trigger automatically on merge.

---

## Triggering a Deploy

### Automatic (recommended)

Push or merge any commit to `main` — the pipeline runs automatically.

### Manual (selective redeploy)

1. Go to your GitHub repository → **Actions** tab
2. Select **Deploy Uptime Agent** from the left sidebar
3. Click **Run workflow**
4. Choose:
   - **Region:** `all`, `singapore`, or `sydney`
   - **Environment:** `production` or `staging`
5. Click **Run workflow**

Useful when you want to redeploy a single region without pushing new code.

---

## What Each Job Does

### `build`

```
actions/checkout
actions/setup-node (Node 22, yarn cache)
yarn install --frozen-lockfile
yarn build:lambda        ← esbuild bundles src/lambda.ts → dist/lambda.js
actions/upload-artifact  ← dist/ shared with deploy jobs
```

The bundle is built once and reused across all region deploy jobs.

### `deploy-singapore` / `deploy-sydney`

```
actions/checkout
actions/download-artifact  ← downloads the shared dist/
aws-actions/configure-aws-credentials (OIDC role assumption)
aws-actions/setup-sam
sam deploy --config-env <region> --parameter-overrides "AgentTokens=..."
aws cloudformation describe-stacks  ← reads endpoint URL
curl /health  ← smoke test against live endpoint
```

Both jobs run in **parallel** after `build` completes.

### `notify`

Always runs (even if deploy jobs fail). Prints the result of each region and exits non-zero if any region failed — this marks the GitHub Actions run as failed.

---

## IAM Permissions Reference

The file `scripts/iam-ci-policy.json` contains the exact permissions granted to the CI role. It is scoped to `uptime-agent-*` resources:

| AWS Service | Why it's needed |
|------------|----------------|
| CloudFormation | SAM manages stacks via CloudFormation |
| Lambda | Create/update the function code and config |
| API Gateway | Create/update the HTTP API |
| S3 (`aws-sam-cli-managed-*`) | SAM uploads the Lambda bundle here |
| IAM (`uptime-agent-*` roles only) | SAM creates a Lambda execution role |
| CloudWatch / Logs | Alarms and log groups defined in `template.yaml` |

---

## Troubleshooting

### `Error: Could not assume role with OIDC`

- Confirm the OIDC provider was created (Step 1)
- Check that `AWS_DEPLOY_ROLE_ARN` secret is set and correct
- Check the trust policy `sub` condition matches your exact repo path (`org/repo`, case-sensitive)

### `No changes to deploy` (workflow still passes)

Expected — `sam deploy --no-fail-on-empty-changeset` skips gracefully when nothing changed.

### `Smoke test failed — curl: (22)`

- The stack deployed but the app returned a non-2xx response on `/health`
- Check CloudWatch Logs: `aws logs tail /aws/lambda/uptime-agent-singapore-production --follow --region ap-southeast-1`
- The deploy job will mark as failed so the `notify` job will also fail

### `The security token included in the request is expired`

- OIDC tokens expire quickly. Re-run the workflow from scratch — do not retry the failed job.

### First-time deploy fails with `S3 bucket does not exist`

- `resolve_s3 = true` in `samconfig.toml` tells SAM to auto-create the bucket. The CI role includes `s3:CreateBucket` on `aws-sam-cli-managed-*` buckets.
- If you see a permission error, verify the role policy was attached correctly (Step 2, command 3).

---

## Adding a New Region

> No code changes required. The same Lambda bundle deploys to any AWS region.  
> Only 3 files need updating — all by copy-paste.

**The only values that change per region:**

| What | Example (Frankfurt) |
|------|-------------------|
| AWS region code | `eu-central-1` |
| Config env name | `frankfurt` |
| Stack name | `uptime-agent-frankfurt` |
| Display name | `Frankfurt` |

---

### Step 1 — `samconfig.toml`

Add a new block at the bottom of the file. Use an existing region block as a template and change the three values above:

```toml
[frankfurt]
[frankfurt.deploy.parameters]
stack_name              = "uptime-agent-frankfurt"
capabilities            = "CAPABILITY_IAM"
confirm_changeset       = false
fail_on_empty_changeset = false
parameter_overrides     = "AgentRegion=\"frankfurt\" Environment=\"production\""
resolve_s3              = true
image_repositories      = []

[frankfurt.global.parameters]
region = "eu-central-1"
```

> Frankfurt and Virginia blocks are already in `samconfig.toml` as comments — just uncomment them.

---

### Step 2 — `.github/workflows/deploy.yml` — add a deploy job

Copy any existing deploy job (e.g. `deploy-sydney`) and change the 4 highlighted values:

```yaml
deploy-frankfurt:                                          # ← 1. job name
  name: Deploy → Frankfurt                                # ← 2. display name
  needs: build
  runs-on: ubuntu-latest
  if: |
    github.ref == 'refs/heads/main' &&
    (github.event_name == 'push' || github.event.inputs.target == 'all' || github.event.inputs.target == 'frankfurt')
  environment:
    name: frankfurt                                        # ← 3. GitHub Environment name
    url: ${{ steps.endpoint.outputs.url }}
  permissions:
    id-token: write
    contents: read

  steps:
    - uses: actions/checkout@v4

    - name: Download dist artifact
      uses: actions/download-artifact@v4
      with:
        name: lambda-dist
        path: dist/

    - name: Configure AWS credentials (OIDC)
      uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
        aws-region: eu-central-1                           # ← 4. AWS region code

    - uses: aws-actions/setup-sam@v2
      with:
        use-installer: true

    - name: Deploy to Frankfurt
      run: |
        sam deploy \
          --config-env frankfurt \
          --parameter-overrides "AgentTokens=${{ secrets.AGENT_TOKENS }}" \
          --no-confirm-changeset \
          --no-fail-on-empty-changeset

    - name: Get endpoint URL
      id: endpoint
      run: |
        URL=$(aws cloudformation describe-stacks \
          --stack-name uptime-agent-frankfurt \
          --region eu-central-1 \
          --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
          --output text)
        echo "url=$URL" >> $GITHUB_OUTPUT

    - name: Smoke test
      run: |
        curl -sf "${{ steps.endpoint.outputs.url }}/health" | jq .
```

---

### Step 3 — `.github/workflows/deploy.yml` — update `notify` job

Add the new job to the `needs` list so the summary includes it:

```yaml
notify:
  name: Deployment summary
  needs: [deploy-singapore, deploy-sydney, deploy-frankfurt]   # ← add here
  runs-on: ubuntu-latest
  if: always()
  steps:
    - name: Report
      run: |
        SG="${{ needs.deploy-singapore.result }}"
        AU="${{ needs.deploy-sydney.result }}"
        DE="${{ needs.deploy-frankfurt.result }}"             # ← add
        echo "Singapore: $SG"
        echo "Sydney:    $AU"
        echo "Frankfurt: $DE"                                 # ← add
        if [[ "$SG" == "failure" || "$AU" == "failure" || "$DE" == "failure" ]]; then
          echo "One or more regions failed — review the logs above."
          exit 1
        fi
```

---

### Step 4 — `.github/workflows/deploy.yml` — update `workflow_dispatch` choices

Add the new region to the manual trigger dropdown:

```yaml
on:
  workflow_dispatch:
    inputs:
      target:
        description: Region to deploy
        type: choice
        options: [all, singapore, sydney, frankfurt]     # ← add here
```

---

### Step 5 — Create the GitHub Environment

In your GitHub repository:  
**Settings → Environments → New environment** → name it `frankfurt`

---

### Checklist summary

- [ ] Block added to `samconfig.toml`
- [ ] Deploy job added to `deploy.yml`
- [ ] `notify` job `needs` list updated
- [ ] `workflow_dispatch` options updated
- [ ] GitHub Environment created
- [ ] Commit and push to `main` — the new region deploys automatically
