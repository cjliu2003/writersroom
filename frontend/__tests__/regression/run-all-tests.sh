#!/bin/bash

# Run All Regression Tests
# This script runs the comprehensive test suite for scene preservation

echo "🧪 WRITERSROOM REGRESSION TEST SUITE"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL=0
PASSED=0
FAILED=0

# Function to run a test file
run_test() {
  local test_file=$1
  local test_name=$2

  echo -e "${YELLOW}Running: ${test_name}${NC}"

  if npm test -- "$test_file" --silent 2>&1 | grep -q "PASS"; then
    echo -e "${GREEN}✅ PASSED${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ FAILED${NC}"
    ((FAILED++))

    # Run again with verbose output for failed tests
    echo "Detailed output:"
    npm test -- "$test_file" --verbose
  fi

  ((TOTAL++))
  echo ""
}

# Check if we're in the frontend directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Must run from frontend directory${NC}"
  exit 1
fi

# Start test run
echo "Starting regression tests..."
echo "Date: $(date)"
echo ""

# 1. Ground Truth Parity Test
run_test "__tests__/regression/gt_parity.test.ts" "Ground Truth Parity Test"

# 2. Duplicate Sluglines Test
run_test "__tests__/regression/duplicate_sluglines.test.ts" "Duplicate Sluglines Test"

# 3. Network Resilience Test
run_test "__tests__/regression/network_flake.test.ts" "Network Resilience Test"

# 4. Runtime Invariants Test
run_test "__tests__/regression/runtime_invariants.test.ts" "Runtime Invariants Test"

# 5. Integration E2E Test
run_test "__tests__/regression/integration_e2e.test.ts" "End-to-End Integration Test"

# Summary
echo "===================================="
echo "TEST SUMMARY"
echo "===================================="
echo -e "Total Tests: ${TOTAL}"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
  echo ""
  echo "Scene preservation is working correctly."
  echo "No regression detected."
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo ""
  echo "Scene preservation may be compromised."
  echo "Please review the failed tests above."
  exit 1
fi