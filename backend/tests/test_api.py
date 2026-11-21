from __future__ import annotations

import litellm
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import build_test_settings, make_fake_response


def test_health_endpoint(client: TestClient):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {
        "status": "ok",
        "keys_configured": 2,
        "cache_enabled": True,
    }


def test_chat_live_and_cross_session_cache_hit(client: TestClient, mock_cached_litellm):
    # First call in session s-1 -> LIVE_INFERENCE
    r1 = client.post(
        "/chat",
        json={"session_id": "s-1", "message": "What is the capital of France?"},
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["session_id"] == "s-1"
    assert body1["reply"] == "Reply to: What is the capital of France?"
    m1 = body1["metadata"]
    assert m1["resolution_source"] == "LIVE_INFERENCE"
    assert m1["model"] == "gemini/gemini-2.0-flash"
    assert m1["key_id"] == "key_1"
    assert m1["fallback_attempts"] == 0
    assert m1["input_tokens"] > 0
    assert m1["output_tokens"] > 0
    assert isinstance(m1["latency_ms"], int)

    # Same first message in a NEW session s-2 -> LLM_CACHE
    r2 = client.post(
        "/chat",
        json={"session_id": "s-2", "message": "What is the capital of France?"},
    )
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["session_id"] == "s-2"
    assert body2["reply"] == body1["reply"]
    m2 = body2["metadata"]
    assert m2["resolution_source"] == "LLM_CACHE"
    assert m2["key_id"] is None
    assert m2["fallback_attempts"] == 0
    assert m2["input_tokens"] == m1["input_tokens"]
    assert m2["output_tokens"] == m1["output_tokens"]
    assert m2["latency_ms"] < m1["latency_ms"]

    # Verify cached assistant message stored in SQLite retains key_id=None
    s2_hist = client.get("/sessions/s-2/messages").json()
    assert s2_hist["messages"][1]["metadata"]["resolution_source"] == "LLM_CACHE"
    assert "key_id" in s2_hist["messages"][1]["metadata"]
    assert s2_hist["messages"][1]["metadata"]["key_id"] is None

    # Different message in s-3 -> LIVE_INFERENCE (never cached)
    r3 = client.post(
        "/chat",
        json={"session_id": "s-3", "message": "What is the capital of Japan?"},
    )
    assert r3.status_code == 200
    assert r3.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert r3.json()["metadata"]["key_id"] == "key_1"


def test_multi_turn_history_and_session_isolation(client: TestClient, mock_cached_litellm):
    r1 = client.post("/chat", json={"session_id": "multi-1", "message": "My name is Aarav."})
    assert r1.status_code == 200

    r2 = client.post("/chat", json={"session_id": "multi-1", "message": "What is my name?"})
    assert r2.status_code == 200

    # Verify turn 2 sent system + turn 1 user + turn 1 assistant + turn 2 user to LLM
    second_call_messages = mock_cached_litellm[-1]["messages"]
    assert [m["role"] for m in second_call_messages] == ["system", "user", "assistant", "user"]
    assert second_call_messages[1]["content"] == "My name is Aarav."
    assert second_call_messages[3]["content"] == "What is my name?"

    # Check GET /sessions/{session_id}/messages (oldest first, no system prompt)
    hist = client.get("/sessions/multi-1/messages")
    assert hist.status_code == 200
    hist_body = hist.json()
    assert hist_body["session_id"] == "multi-1"
    assert len(hist_body["messages"]) == 4
    assert [m["role"] for m in hist_body["messages"]] == ["user", "assistant", "user", "assistant"]
    assert "metadata" not in hist_body["messages"][0]
    assert hist_body["messages"][1]["metadata"]["resolution_source"] == "LIVE_INFERENCE"

    # Unknown session returns 404
    missing = client.get("/sessions/does-not-exist/messages")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "session not found"}


def test_system_prompt_override_persists_per_session(client: TestClient, mock_cached_litellm):
    r1 = client.post(
        "/chat",
        json={
            "session_id": "sys-1",
            "message": "Hello",
            "system_prompt": "Always speak like a pirate.",
        },
    )
    assert r1.status_code == 200
    assert mock_cached_litellm[-1]["messages"][0] == {
        "role": "system",
        "content": "Always speak like a pirate.",
    }

    # Follow-up turn without system_prompt keeps the session's custom prompt
    r2 = client.post("/chat", json={"session_id": "sys-1", "message": "How are you?"})
    assert r2.status_code == 200
    assert mock_cached_litellm[-1]["messages"][0] == {
        "role": "system",
        "content": "Always speak like a pirate.",
    }

    # History endpoint never includes system prompt
    hist = client.get("/sessions/sys-1/messages").json()
    assert all(m["role"] != "system" for m in hist["messages"])


def test_real_provider_failover_on_429_and_500(client: TestClient, monkeypatch):
    seen_keys = []

    def fake_completion(**kwargs):
        api_key = kwargs["api_key"]
        seen_keys.append(api_key)
        if api_key == "secret_key_one":
            raise litellm.RateLimitError(
                message="Rate limit exceeded",
                llm_provider="gemini",
                model="gemini/gemini-2.0-flash",
            )
        return make_fake_response(content="Recovered via key 2", prompt_tokens=15, completion_tokens=5)

    monkeypatch.setattr(litellm, "completion", fake_completion)

    res = client.post("/chat", json={"session_id": "failover-real", "message": "Test failover"})
    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "Recovered via key 2"
    assert body["metadata"]["key_id"] == "key_2"
    assert body["metadata"]["fallback_attempts"] == 1
    assert body["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert seen_keys == ["secret_key_one", "secret_key_two"]
    # Ensure secret key string is never leaked in response
    assert "secret_key_one" not in res.text
    assert "secret_key_two" not in res.text


def test_simulate_failure_header_key1_429_and_500(client: TestClient, mock_cached_litellm):
    # key_1=429 -> fails over to key_2
    r1 = client.post(
        "/chat",
        headers={"X-Simulate-Failure": "key_1=429"},
        json={"session_id": "sim-1", "message": "Ping"},
    )
    assert r1.status_code == 200
    m1 = r1.json()["metadata"]
    assert m1["key_id"] == "key_2"
    assert m1["fallback_attempts"] == 1
    assert m1["resolution_source"] == "LIVE_INFERENCE"

    # key_1=500 -> fails over to key_2
    r2 = client.post(
        "/chat",
        headers={"X-Simulate-Failure": "key_1=500"},
        json={"session_id": "sim-2", "message": "Ping"},
    )
    assert r2.status_code == 200
    assert r2.json()["metadata"]["key_id"] == "key_2"
    assert r2.json()["metadata"]["fallback_attempts"] == 1

    # Subsequent request without header uses key_1 again (failure simulation is per-request only)
    r3 = client.post("/chat", json={"session_id": "sim-3", "message": "Fresh message"})
    assert r3.status_code == 200
    assert r3.json()["metadata"]["key_id"] == "key_1"
    assert r3.json()["metadata"]["fallback_attempts"] == 0


def test_simulate_failure_all_keys_returns_503_and_skips_history(client: TestClient, mock_cached_litellm):
    res = client.post(
        "/chat",
        headers={"X-Simulate-Failure": "*=429"},
        json={"session_id": "sim-all-down", "message": "Should fail"},
    )
    assert res.status_code == 503
    assert res.json() == {"detail": "all providers unavailable"}

    # Nothing added to SQLite history
    hist = client.get("/sessions/sim-all-down/messages")
    assert hist.status_code == 404

    # Explicit multi-key pair failure also returns 503
    res2 = client.post(
        "/chat",
        headers={"X-Simulate-Failure": "key_1=429, key_2=503"},
        json={"session_id": "sim-both-down", "message": "Should also fail"},
    )
    assert res2.status_code == 503
    assert res2.json() == {"detail": "all providers unavailable"}
    assert client.get("/sessions/sim-both-down/messages").status_code == 404


def test_simulate_failure_ignored_when_disabled(tmp_path, mock_cached_litellm):
    settings = build_test_settings(tmp_path, enable_failure_simulation=False)
    app = create_app(settings_override=settings)
    with TestClient(app) as disabled_client:
        res = disabled_client.post(
            "/chat",
            headers={"X-Simulate-Failure": "*=429"},
            json={"session_id": "sim-off", "message": "Should succeed on key_1"},
        )
        assert res.status_code == 200
        assert res.json()["metadata"]["key_id"] == "key_1"
        assert res.json()["metadata"]["fallback_attempts"] == 0


def test_validation_errors_return_422_and_do_not_save(client: TestClient, mock_cached_litellm):
    # Empty message after trimming
    r1 = client.post("/chat", json={"session_id": "val-1", "message": "    "})
    assert r1.status_code == 422
    assert "detail" in r1.json()
    assert client.get("/sessions/val-1/messages").status_code == 404

    # Message over 4000 chars
    r2 = client.post("/chat", json={"session_id": "val-2", "message": "x" * 4001})
    assert r2.status_code == 422
    assert client.get("/sessions/val-2/messages").status_code == 404

    # Missing session_id
    r3 = client.post("/chat", json={"message": "hello"})
    assert r3.status_code == 422

    # session_id over 128 chars
    r4 = client.post("/chat", json={"session_id": "s" * 129, "message": "hello"})
    assert r4.status_code == 422

    # Malformed JSON
    r5 = client.post("/chat", content="{bad json", headers={"Content-Type": "application/json"})
    assert r5.status_code == 422
    assert "detail" in r5.json()
