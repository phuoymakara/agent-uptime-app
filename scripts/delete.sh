#!/usr/bin/env bash
# Deletes uptime-agent CloudFormation stacks (Lambda + API Gateway + alarms).
# DESTRUCTIVE — this permanently removes the deployed app in the target region(s).
#
# Usage:
#   ./scripts/delete.sh singapore
#   ./scripts/delete.sh sydney
#   ./scripts/delete.sh frankfurt
#   ./scripts/delete.sh all
#
# Add -y / --yes to skip the confirmation prompt (e.g. for scripted use).
#
# Prerequisites: aws CLI, sam CLI

set -euo pipefail

TARGET=""
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=true ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="${TARGET:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 [singapore|sydney|frankfurt|all] [-y|--yes]"
  exit 1
fi

if ! command -v sam &>/dev/null; then
  echo "ERROR: AWS SAM CLI not found."
  exit 1
fi

declare -A REGIONS=(
  [singapore]="ap-southeast-1"
  [sydney]="ap-southeast-2"
  [frankfurt]="eu-central-1"
)

case "$TARGET" in
  singapore|sydney|frankfurt) TARGETS=("$TARGET") ;;
  all) TARGETS=(singapore sydney frankfurt) ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [singapore|sydney|frankfurt|all] [-y|--yes]"
    exit 1
    ;;
esac

echo "The following stacks will be PERMANENTLY DELETED:"
for name in "${TARGETS[@]}"; do
  echo "  - uptime-agent-$name (${REGIONS[$name]})"
done
echo ""

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Type the target name again to confirm (\"$TARGET\"): " CONFIRM
  if [[ "$CONFIRM" != "$TARGET" ]]; then
    echo "Confirmation did not match. Aborting."
    exit 1
  fi
fi

delete_region() {
  local env_name="$1"
  local aws_region="${REGIONS[$env_name]}"
  local stack_name="uptime-agent-$env_name"

  echo ""
  echo "==> Deleting $stack_name ($aws_region)..."
  sam delete \
    --stack-name "$stack_name" \
    --region "$aws_region" \
    --no-prompts
  echo "    $stack_name — deleted"
}

for name in "${TARGETS[@]}"; do
  delete_region "$name"
done

echo ""
echo "Done."
