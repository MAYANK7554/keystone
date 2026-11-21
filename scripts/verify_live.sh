#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-http://localhost:8000}"
API_URL="${API_URL%/}"
TS="$(date +%s)"

echo "============================================================"
echo "Verifying Keystone Backend at: ${API_URL}"
echo "============================================================"

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1"; exit 1; }

# 1. GET /health
echo ""
echo "1. Checking GET /health ..."
HEALTH=$(curl -sS -w "\n%{http_code}" "${API_URL}/health")
CODE=$(echo "$HEALTH" | tail -n1)
BODY=$(echo "$HEALTH" | sed '$d')
echo "   Response (${CODE}): ${BODY}"
[ "$CODE" -eq 200 ] || fail "Expected 200 from /health, got ${CODE}"
echo "$BODY" | grep -q '"status":"ok"' || echo "$BODY" | grep -q '"status": "ok"' || fail "Missing status=ok"
pass "/health returned 200 ok"

# 2. POST /chat — Live inference
PROMPT="What is the capital of France? (${TS})"
S1="verify-s1-${TS}"
S2="verify-s2-${TS}"
echo ""
echo "2. Checking POST /chat (LIVE_INFERENCE) ..."
R1=$(curl -sS -w "\n%{http_code}" -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"${S1}\",\"message\":\"${PROMPT}\"}")
CODE=$(echo "$R1" | tail -n1)
BODY1=$(echo "$R1" | sed '$d')
echo "   Response (${CODE}): ${BODY1}"
[ "$CODE" -eq 200 ] || fail "Expected 200 from /chat, got ${CODE}"
echo "$BODY1" | grep -q '"LIVE_INFERENCE"' || fail "Expected LIVE_INFERENCE on first call"
echo "$BODY1" | grep -q '"key_1"' || fail "Expected key_1 on first call"
pass "First call served via LIVE_INFERENCE on key_1"

# 3. POST /chat — Cross-session cache hit
echo ""
echo "3. Checking POST /chat cross-session cache hit (LLM_CACHE) ..."
R2=$(curl -sS -w "\n%{http_code}" -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"${S2}\",\"message\":\"${PROMPT}\"}")
CODE=$(echo "$R2" | tail -n1)
BODY2=$(echo "$R2" | sed '$d')
echo "   Response (${CODE}): ${BODY2}"
[ "$CODE" -eq 200 ] || fail "Expected 200 on cached /chat, got ${CODE}"
echo "$BODY2" | grep -q '"LLM_CACHE"' || fail "Expected LLM_CACHE on identical first message in new session"
echo "$BODY2" | grep -q '"key_id":null' || echo "$BODY2" | grep -q '"key_id": null' || fail "Expected key_id=null on cache hit"
pass "Second session hit LLM_CACHE with key_id=null"

# 4. Multi-turn history + GET /sessions/{id}/messages
echo ""
echo "4. Checking multi-turn + GET /sessions/${S1}/messages ..."
curl -sS -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"${S1}\",\"message\":\"Name one famous landmark there.\"}" > /dev/null
HIST=$(curl -sS -w "\n%{http_code}" "${API_URL}/sessions/${S1}/messages")
CODE=$(echo "$HIST" | tail -n1)
[ "$CODE" -eq 200 ] || fail "Expected 200 from /sessions/${S1}/messages, got ${CODE}"
pass "Session history persisted and returned cleanly"

# 5. X-Simulate-Failure: key_1=429 -> key_2
echo ""
echo "5. Checking failover with X-Simulate-Failure: key_1=429 ..."
F1=$(curl -sS -w "\n%{http_code}" -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: key_1=429" \
  -d "{\"session_id\":\"verify-f1-${TS}\",\"message\":\"Reply with the single word OK (${TS})\"}")
CODE=$(echo "$F1" | tail -n1)
F1_BODY=$(echo "$F1" | sed '$d')
echo "   Response (${CODE}): ${F1_BODY}"
[ "$CODE" -eq 200 ] || fail "Expected 200 failover response, got ${CODE}"
echo "$F1_BODY" | grep -q '"key_2"' || fail "Expected failover to key_2"
pass "Simulated key_1=429 failed over cleanly to key_2"

# 6. X-Simulate-Failure: *=429 -> 503 + not stored
echo ""
echo "6. Checking all-keys-down with X-Simulate-Failure: *=429 ..."
SFAIL="verify-allfail-${TS}"
F2=$(curl -sS -w "\n%{http_code}" -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: *=429" \
  -d "{\"session_id\":\"${SFAIL}\",\"message\":\"Should fail cleanly\"}")
CODE=$(echo "$F2" | tail -n1)
F2_BODY=$(echo "$F2" | sed '$d')
echo "   Response (${CODE}): ${F2_BODY}"
[ "$CODE" -eq 503 ] || fail "Expected 503 when all keys fail, got ${CODE}"
echo "$F2_BODY" | grep -q 'all providers unavailable' || fail "Expected 'all providers unavailable' detail"

HIST_FAIL_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${API_URL}/sessions/${SFAIL}/messages")
[ "$HIST_FAIL_CODE" -eq 404 ] || fail "Expected 404 for failed session history, got ${HIST_FAIL_CODE}"
pass "All-keys failure returned 503 and wrote nothing to SQLite"

# 7. Validation 422 check
echo ""
echo "7. Checking 422 validation on blank message ..."
VAL_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${API_URL}/chat" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"verify-val","message":"   "}')
[ "$VAL_CODE" -eq 422 ] || fail "Expected 422 for blank message, got ${VAL_CODE}"
pass "Blank message returned 422"

echo ""
echo "============================================================"
echo "ALL CHECKS PASSED!"
echo "============================================================"
