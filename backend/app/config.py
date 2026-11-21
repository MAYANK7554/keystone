from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class KeyEntry:
    key_id: str
    api_key: str
    model: str


@dataclass(frozen=True)
class Settings:
    key_pool: List[KeyEntry]
    default_model: str
    database_url: str
    allowed_origins: List[str]
    enable_failure_simulation: bool
    cache_enabled: bool
    cache_type: str
    cache_dir: str
    default_system_prompt: str
    llm_timeout_seconds: float


def _load_dotenv_if_present() -> None:
    """Load key=value pairs from repo root or backend .env without overriding existing env vars."""
    candidates = [
        Path(__file__).resolve().parents[2] / ".env",
        Path(__file__).resolve().parents[1] / ".env",
    ]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                if key:
                    os.environ.setdefault(key, value)
        except OSError:
            continue


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_csv(value: str | None) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def load_settings() -> Settings:
    _load_dotenv_if_present()

    raw_keys = _parse_csv(os.getenv("LLM_API_KEYS"))
    default_model = os.getenv("LLM_MODEL", "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"
    per_key_models = _parse_csv(os.getenv("LLM_MODELS"))

    key_pool: List[KeyEntry] = []
    for idx, api_key in enumerate(raw_keys, start=1):
        model = per_key_models[idx - 1] if idx - 1 < len(per_key_models) else default_model
        key_pool.append(KeyEntry(key_id=f"key_{idx}", api_key=api_key, model=model))

    raw_origins = _parse_csv(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"))
    allowed_origins = [origin.rstrip("/") for origin in raw_origins] or ["*"]

    cache_type = os.getenv("CACHE_TYPE", "local").strip().lower()
    if cache_type not in {"local", "disk"}:
        cache_type = "local"

    try:
        timeout = float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))
    except ValueError:
        timeout = 30.0

    return Settings(
        key_pool=key_pool,
        default_model=default_model,
        database_url=os.getenv("DATABASE_URL", "sqlite:///./data/app.db").strip() or "sqlite:///./data/app.db",
        allowed_origins=allowed_origins,
        enable_failure_simulation=_parse_bool(os.getenv("ENABLE_FAILURE_SIMULATION"), default=False),
        cache_enabled=_parse_bool(os.getenv("CACHE_ENABLED"), default=True),
        cache_type=cache_type,
        cache_dir=os.getenv("CACHE_DIR", "./data/litellm_cache").strip() or "./data/litellm_cache",
        default_system_prompt=os.getenv(
            "DEFAULT_SYSTEM_PROMPT",
            "You are a helpful, accurate, and concise AI assistant.",
        ).strip(),
        llm_timeout_seconds=timeout,
    )
