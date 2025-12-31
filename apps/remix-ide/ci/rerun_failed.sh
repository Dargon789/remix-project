#!/usr/bin/env bash

set -e

BUILD_ID=${CIRCLE_BUILD_NUM:-local}
echo "$BUILD_ID"
TEST_EXITCODE=0

# Accept workflow name as optional second argument (default: web)
BROWSER=${1:-chrome}
WORKFLOW_NAME=${2:-web}

# Start required services
npx ganache > /dev/null 2>&1 &
npx http-server -p 9090 --cors='*' ./node_modules > /dev/null 2>&1 &
yarn run serve:production > /dev/null 2>&1 &
sleep 5

mkdir -p reports/failed

# Compile tests if dist is missing
if [ ! -d "dist/apps/remix-ide-e2e/src/tests" ]; then
  echo "dist not found; compiling E2E tests..."
  yarn inject-e2e-config
  yarn run build:e2e
fi

# Check if failed-basenames.txt was already created by CircleCI job
# If so, use it instead of fetching again (avoids duplicate API calls)
if [ -f "failed-basenames.txt" ] && [ -s "failed-basenames.txt" ]; then
  echo "Using failed test list from CircleCI job..."
  FAILED_BASENAMES=$(cat failed-basenames.txt)
else
  # Fetch failing test basenames from last workflow run
  FAILED_BASENAMES=""
  if [ -n "${CIRCLECI_TOKEN:-}" ]; then
    echo "Fetching last run failing tests for branch ${CIRCLE_BRANCH:-all} from workflow ${WORKFLOW_NAME}..."
    FAILED_BASENAMES=$(node scripts/circleci-failed-tests.js --slug ${CIRCLECI_PROJECT_SLUG:-gh/remix-project-org/remix-project} --workflow "$WORKFLOW_NAME" --branch "${CIRCLE_BRANCH:-}" --jobs "remix-ide-browser" --limit 1 || true)
  else
    echo "CIRCLECI_TOKEN not set; cannot fetch failed tests. Exiting without running."
    exit 0
  fi
fi

# Build file list from basenames
TESTFILES=""
if [ -n "$FAILED_BASENAMES" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    TESTFILES+="$name\n"
  done <<< "$FAILED_BASENAMES"
fi

echo -e "$TESTFILES" | sed '/^$/d' > reports/failed/files.txt
COUNT=$(wc -l < reports/failed/files.txt | awk '{print $1}')

if [ "$COUNT" -eq 0 ]; then
  echo "No failing tests found in last run."
  exit 0
fi

echo "Will rerun $COUNT failing test(s):"
cat reports/failed/files.txt

# Prepare slither toolchain if remixd tests are present among failed ones
cat reports/failed/files.txt | ./apps/remix-ide/ci/setup_slither_if_needed.sh

# Default to single attempt for clean measurement unless overridden
E2E_RETRIES=${E2E_RETRIES:-0}

for TESTFILE in $(cat reports/failed/files.txt); do
  echo "Running failed test: ${TESTFILE}.js"
  attempt=0
  while true; do
    if npx nightwatch --config dist/apps/remix-ide-e2e/nightwatch-${BROWSER}.js dist/apps/remix-ide-e2e/src/tests/${TESTFILE}.js --env=$BROWSER; then
      break
    fi
    if [ "$attempt" -lt "$E2E_RETRIES" ]; then
      attempt=$((attempt+1))
      echo "Retrying ${TESTFILE}.js (attempt $attempt of $E2E_RETRIES)"
      continue
    else
      TEST_EXITCODE=1
      break
    fi
  done
  [ "$TEST_EXITCODE" -eq 1 ] && break
done

# Exit with failure if any test failed again
if [ "$TEST_EXITCODE" -eq 1 ]; then
  exit 1
fi
