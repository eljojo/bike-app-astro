#!/usr/bin/env bash
set -euo pipefail

HOOKS_DIR="$(git rev-parse --show-toplevel)/.git/hooks"

cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail

echo "Running lint..."
npx eslint src/

echo "Running typecheck..."
npx tsc --noEmit

echo "Validating _ctx/..."
npx tsx scripts/validate-ctx.ts

echo "Pre-commit checks passed."
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "Pre-commit hook installed."
