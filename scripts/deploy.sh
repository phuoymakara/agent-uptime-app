#!/usr/bin/env bash
# Manual deploy script for uptime-agent
# Usage:
#   ./scripts/deploy.sh singapore
#   ./scripts/deploy.sh sydney
#   ./scripts/deploy.sh all
#
# Prerequisites: aws CLI, sam CLI, yarn, AGENT_TOKENS env var set

set -euo pipefail

TARGET="${1:-all}"
TOKENS="${AGENT_TOKENS:-}"

if [[ -z "$TOKENS" ]]; then
  echo "ERROR: AGENT_TOKENS environment variable is not set."
  echo "  export AGENT_TOKENS='token1,token2'"
  exit 1
fi

if ! command -v sam &>/dev/null; then
  echo "ERROR: AWS SAM CLI not found. Install from https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
  exit 1
fi

echo "==> Building Lambda bundle..."
yarn install --frozen-lockfile
yarn build:lambda
echo "    Bundle ready at dist/lambda.js ($(du -sh dist/lambda.js | cut -f1))"

deploy_region() {
  local env_name="$1"
  local display="$2"
  local aws_region="$3"

  echo ""
  echo "==> Deploying to $display ($aws_region)..."
  sam deploy \
    --config-env "$env_name" \
    --parameter-overrides "AgentTokens=$TOKENS" \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --region "$aws_region"

  local stack_name="uptime-agent-$env_name"
  local endpoint
  endpoint=$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$aws_region" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text 2>/dev/null || echo "")

  if [[ -n "$endpoint" ]]; then
    echo "    Endpoint: $endpoint"
    echo "    Smoke test..."
    if curl -sf "$endpoint/health" | jq .; then
      echo "    $display — OK"
    else
      echo "    WARNING: health check failed for $display"
    fi
  fi
}

case "$TARGET" in
  singapore)
    deploy_region singapore "Singapore" ap-southeast-1
    ;;
  sydney)
    deploy_region sydney "Sydney" ap-southeast-2
    ;;
  all)
    deploy_region singapore "Singapore" ap-southeast-1
    deploy_region sydney    "Sydney"    ap-southeast-2
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [singapore|sydney|all]"
    exit 1
    ;;
esac

echo ""
echo "Done."
