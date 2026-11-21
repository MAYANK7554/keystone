from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from app.config import KeyEntry, Settings
from app.main import create_app


def make_fake_response(
    content: str = "The capital of France is Paris.",
    prompt_tokens: int = 42,
    completion_tokens: int = 9,
    cache_hit: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        ),
        _hidden_params={"cache_hit": cache_hit},
    )


def build_test_settings(
    tmp_path,
    enable_failure_simulation: bool = True,
    cache_enabled: bool = True,
) -> Settings:
    db_file = tmp_path / "test_app.db"
    return Settings(
        key_pool=[
            KeyEntry(key_id="key_1", api_key="secret_key_one", model="gemini/gemini-2.0-flash"),
            KeyEntry(key_id="key_2", api_key="secret_key_two", model="gemini/gemini-2.0-flash"),
        ],
        default_model="gemini/gemini-2.0-flash",
        database_url=f"sqlite:///{db_file}",
        allowed_origins=["http://localhost:3000"],
        enable_failure_simulation=enable_failure_simulation,
        cache_enabled=cache_enabled,
        cache_type="local",
        cache_dir=str(tmp_path / "cache"),
        default_system_prompt="You are a helpful assistant.",
        llm_timeout_seconds=10.0,
    )


@pytest.fixture
def client(tmp_path):
    settings = build_test_settings(tmp_path)
    app = create_app(settings_override=settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mock_cached_litellm(monkeypatch):
    """Simulates LiteLLM's in-memory cache keyed by (model, messages) with controllable live latency."""
    import json
    import time
    import litellm

    store: Dict[str, Any] = {}
    calls: List[Dict[str, Any]] = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        model = kwargs["model"]
        messages = kwargs["messages"]
        caching = kwargs.get("caching", False)
        cache_key = json.dumps({"model": model, "messages": messages}, sort_keys=True)

        if caching and cache_key in store:
            cached = store[cache_key]
            return make_fake_response(
                content=cached["content"],
                prompt_tokens=cached["prompt_tokens"],
                completion_tokens=cached["completion_tokens"],
                cache_hit=True,
            )

        # Simulate small live network latency so live > cache hit
        time.sleep(0.025)
        last_user = messages[-1]["content"]
        reply = f"Reply to: {last_user}"
        prompt_tokens = sum(len(m["content"].split()) for m in messages) * 2
        completion_tokens = len(reply.split()) * 2

        if caching:
            store[cache_key] = {
                "content": reply,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            }

        return make_fake_response(
            content=reply,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cache_hit=False,
        )

    monkeypatch.setattr(litellm, "completion", fake_completion)
    return calls
