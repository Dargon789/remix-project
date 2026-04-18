#!/usr/bin/env bash

set -e

TESTFILES=$(grep -IRiL "\'@disabled\': \?true" "dist/apps/remix-ide-e2e/src/tests" | grep -i "${4}" | sort )

# count test files
fileCount=$(grep -IRiL "\'@disabled\': \?true" "dist/apps/remix-ide-e2e/src/tests" | grep -i "${4}" | wc -l )
# if fileCount is 0
if [ $fileCount -eq 0 ]
then
  echo "No flaky or PR tests found"
  exit 0
fi

BUILD_ID=${CIRCLE_BUILD_NUM:-local}
echo "$BUILD_ID"
TEST_EXITCODE=0

npx ganache &
npx http-server -p 9090 --cors='*' ./node_modules &
yarn run serve:production &
sleep 5

# Prepare slither toolchain if remixd tests are present in this selection
printf '%s\n' "$TESTFILES" | ./apps/remix-ide/ci/setup_slither_if_needed.sh

for TESTFILE in $TESTFILES; do
    npx nightwatch --config dist/apps/remix-ide-e2e/nightwatch-${1}.js $TESTFILE --env=$1  || TEST_EXITCODE=1
done

echo "$TEST_EXITCODE"
if [ "$TEST_EXITCODE" -eq 1 ]
then
  exit 1
fi
