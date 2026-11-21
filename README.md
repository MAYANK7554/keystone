# Keystone — Resilient LLM Gateway with Key Failover & Response Caching

A full-stack multi-turn AI chatbot built with **React (Vite + TypeScript)**, **FastAPI**, **LiteLLM**, and **SQLite**, featuring deterministic API key pool failover, built-in response caching, per-request token accounting, and on-demand failure simulation.

---

## 1. Live URLs

- **Frontend:** `https://<your-frontend-url>.vercel.app` *(update after deploying frontend)*
- **Backend:** `https://<your-backend-url>.onrender.com` *(update after deploying backend)*
- **Health Check:** `https://<your-backend-url>.onrender.com/health`

---

## 2. Run locally

### With Docker (Recommended)

1. Copy the example environment file and add at least two valid LLM API keys:
   ```bash
   cp .env.example .env
   # Edit .env and set LLM_API_KEYS=keyA,keyB and LLM_MODEL=gemini/gemini-2.0-flash
   ```
2. Start the entire stack (backend on `http://localhost:8000`, frontend on `http://localhost:3000`):
   ```bash
   make up
   ```
3. View logs or stop containers:
   ```bash
   make logs
   make down
   ```

SQLite data is persisted in the named Docker volume `sqlite_data` mounted at `/data/app.db`, so conversation history survives `make down && make up`.

### Without Docker

#### Backend (Python 3.11+)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

export LLM_API_KEYS="your_key_1,your_key_2"
export LLM_MODEL="gemini/gemini-2.0-flash"
export DATABASE_URL="sqlite:///./data/app.db"
export ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
export ENABLE_FAILURE_SIMULATION="true"

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend (Node 20+)
```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev -- --port 3000
```

#### Run Backend Tests
```bash
cd backend
pytest -v
```

---

## 3. Design decisions

### Key Fallback & Resilience
- **Ordered Key Pool (`key_1`, `key_2`, ...):** Keys from `LLM_API_KEYS` are loaded in deterministic order and assigned opaque IDs (`key_1`, `key_2`, ...). Raw API keys are never exposed in responses, error details, or logs. Optional `LLM_MODELS` allows pairing keys with distinct LiteLLM models (e.g. Gemini primary + Groq fallback) or sharing a single model across multiple keys.
- **Automatic Failover:** On HTTP `429` (rate limit/quota), `5xx` (`500`, `502`, `503`, `504`), timeouts, connection errors, or provider auth/quota rejections from LiteLLM, the gateway automatically advances to the next key and increments `fallback_attempts`.
- **Clean Error Handling:** If every key fails, the API returns HTTP `503` with `{"detail": "all providers unavailable"}` and rolls back / skips database persistence so failed requests never corrupt session history. Global FastAPI exception handlers guarantee JSON responses with `detail` and never leak stack traces or HTML error pages.
- **Per-Request Failure Simulation:** When `ENABLE_FAILURE_SIMULATION=true`, the `X-Simulate-Failure` header injects synthetic `429`/`500`/`502`/`503` errors for targeted keys (`key_1=429`, `key_1=429, key_2=500`, `*=429`) strictly scoped to that single request without mutating global pool state. Cache lookup is bypassed whenever an active simulation header is supplied so failover is always exercised deterministically.

### Response Caching
- **LiteLLM Built-in Cache:** Uses LiteLLM's native `Cache` (`local` in-memory by default, or `disk` via `CACHE_TYPE=disk`).
- **Exact Cache Key Semantics:** Requests pass `(model, full_messages)` — where `full_messages` is `[system_prompt] + session_history + [new_user_message]` — to `litellm.completion(..., caching=True)`. Because `session_id` is excluded from the LLM payload, sending the identical first message in a brand-new session hits the cache (`LLM_CACHE`), returning the identical reply text, stored per-request token usage, `key_id: null`, `fallback_attempts: 0`, and sub-millisecond latency. Different messages or different conversation histories naturally produce distinct cache keys.

### SQLite Session Storage
- **Pure SQLite with WAL Mode:** No external cache or database servers (no Redis, no Postgres). SQLite runs in `WAL` journal mode with a 5-second `busy_timeout` for safe concurrent access.
- **Auto-Initialized Schema:** On FastAPI lifespan startup, the parent directory and tables (`messages` and `sessions`) are created automatically. The `messages` table matches the required minimal schema plus a composite `(session_id, id)` index for fast ordered history reads.
- **Atomic Turn Persistence:** User and assistant messages for a turn are inserted inside a single transaction *after* a non-empty reply is produced. Requests failing with `422` or `503` never write partial records. System prompts are stored per session in the `sessions` table and excluded from `GET /sessions/{session_id}/messages`.

---

## 4. Verification

Set your backend base URL (local or deployed):
```bash
export API="http://localhost:8000"
```

### 1. Health Check
```bash
curl -s "$API/health" | jq
# Expected: { "status": "ok", "keys_configured": 2, "cache_enabled": true }
```

### 2. Live Inference & Per-Message Token Usage
```bash
curl -s -X POST "$API/chat"   -H "Content-Type: application/json"   -d '{"session_id": "demo-s1", "message": "What is the capital of France?"}' | jq
# Expected: resolution_source="LIVE_INFERENCE", key_id="key_1", fallback_attempts=0, input_tokens>0, output_tokens>0
```

### 3. Cache Hit Across a New Session
Send the exact same first message in a **new** session:
```bash
curl -s -X POST "$API/chat"   -H "Content-Type: application/json"   -d '{"session_id": "demo-s2", "message": "What is the capital of France?"}' | jq
# Expected: resolution_source="LLM_CACHE", key_id=null, fallback_attempts=0, identical reply, lower latency_ms
```

### 4. Multi-Turn Context & SQLite History
```bash
curl -s -X POST "$API/chat"   -H "Content-Type: application/json"   -d '{"session_id": "demo-s1", "message": "What country is that city in?"}' | jq

curl -s "$API/sessions/demo-s1/messages" | jq
# Expected: 4 messages oldest-first, no system prompt, assistant metadata included
```

### 5. Failover with `X-Simulate-Failure`
```bash
# Simulate HTTP 429 on key_1 -> fails over cleanly to key_2
curl -s -X POST "$API/chat"   -H "Content-Type: application/json"   -H "X-Simulate-Failure: key_1=429"   -d '{"session_id": "demo-failover", "message": "Say hello in one word."}' | jq
# Expected: 200 OK, key_id="key_2", fallback_attempts=1, resolution_source="LIVE_INFERENCE"

# Simulate all keys failing -> clean 503, nothing saved to SQLite
curl -i -X POST "$API/chat"   -H "Content-Type: application/json"   -H "X-Simulate-Failure: *=429"   -d '{"session_id": "demo-all-fail", "message": "This should fail cleanly."}'
# Expected: HTTP 503 {"detail": "all providers unavailable"}

curl -i "$API/sessions/demo-all-fail/messages"
# Expected: HTTP 404 {"detail": "session not found"}
```

### 6. Validation Error (`422`)
```bash
curl -i -X POST "$API/chat"   -H "Content-Type: application/json"   -d '{"session_id": "demo-invalid", "message": "   "}'
# Expected: HTTP 422 {"detail": [...]}
```

---

## 5. Setup Used

- **Editor:** VS Code / Cursor
- **AI Tools:** Gemini / AI coding assistants for architecture review, test scaffolding, and boilerplate acceleration
- **Runtime & Stack:** Python 3.11, FastAPI, LiteLLM, SQLite, React 18, TypeScript, Vite, Tailwind CSS, Docker (multi-stage builds)

---

## 6. Bonus features

1. **Interactive Failover Simulator UI:** A collapsible sidebar panel lets reviewers toggle `X-Simulate-Failure` presets (`key_1=429`, `key_1=500`, `*=429`, or custom pairs) directly from the browser without needing `curl` — off by default so standard traffic stays unaffected.
2. **Custom System Prompt per Session:** Persisted in SQLite's `sessions` table via `system-prompt-input`, automatically applied to all subsequent turns in that session while staying hidden from `GET /sessions/{session_id}/messages`.
3. **One-Click Session Reset & History Reload:** Start a fresh session instantly in the UI (great for verifying cross-session cache hits) or re-fetch the current session directly from SQLite via `GET /sessions/{session_id}/messages`.
4. **Live Gateway Health Indicator & Per-Reply Key/Failover Telemetry:** Displays real-time `/health` status in the header and highlights `key_id` and `fallback_attempts` alongside the required metadata badges.
5. **Multi-Model Key Pool Support (`LLM_MODELS`):** Supports both multiple keys for one model and heterogeneous multi-provider fallback pools (e.g., Gemini -> Groq -> OpenAI) via environment variables alone.
