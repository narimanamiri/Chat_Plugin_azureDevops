#!/usr/bin/env bash
# One-command verification gate for Team Chat. Run from anywhere:
#
#     bash docs/ai-handoff/tools/run_gate.sh
#
# Steps: type-check, rebuild the compiled core for tests, run all node:test suites,
# run the fuzz script. Unlike `node tests/fuzz.mjs` on its own, this script FAILS
# (exit 1) when the fuzz run reports any failure, because fuzz.mjs only prints.
#
# It calls node_modules/.bin directly, so it works even where `npm run` is broken
# (see 08_DEVELOPMENT_SETUP.md). Writes only the gitignored tests/build/ folder.

set -u
cd "$(dirname "$0")/../../.." || exit 2
status=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "== 1/4 type-check (tsc --noEmit)"
if ./node_modules/.bin/tsc --noEmit; then echo "   ok"; else echo "   FAILED"; status=1; fi

echo "== 2/4 compile src/core for tests"
if ./node_modules/.bin/tsc -p tsconfig.test.json; then
  node -e "require('fs').writeFileSync('tests/build/package.json', JSON.stringify({type: 'commonjs'}))"
  echo "   ok"
else
  echo "   FAILED"; status=1
fi

echo "== 3/4 node:test suites"
node --test tests/mentions.test.mjs tests/integration.test.mjs tests/features.test.mjs >"$tmp" 2>&1
tests=$(grep -aE "^(ℹ|#) tests " "$tmp" | grep -aoE "[0-9]+" | tail -1)
pass=$(grep -aE "^(ℹ|#) pass " "$tmp" | grep -aoE "[0-9]+" | tail -1)
fail=$(grep -aE "^(ℹ|#) fail " "$tmp" | grep -aoE "[0-9]+" | tail -1)
echo "   tests=${tests:-?} pass=${pass:-?} fail=${fail:-?}"
if [ "${fail:-1}" != "0" ] || [ -z "${tests:-}" ]; then
  echo "   FAILED - last lines of output:"; tail -n 25 "$tmp"; status=1
fi

echo "== 4/4 fuzz (60 randomised steps)"
node tests/fuzz.mjs >"$tmp" 2>&1
last=$(tail -n 1 "$tmp")
echo "   $last"
case "$last" in
  *"-> 0 failure(s)"*) ;;
  *) echo "   FAILED - fuzz reported failures:"; tail -n 15 "$tmp"; status=1 ;;
esac

echo
if [ "$status" = "0" ]; then echo "GATE PASSED"; else echo "GATE FAILED"; fi
exit "$status"
