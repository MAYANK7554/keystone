from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import litellm

try:
    from litellm.caching.caching import Cache
except ImportError:  # pragma: no cover - older litellm fallback
    from litellm import Cache

from app.config import KeyEntry, Settings

logger = logging.getLogger("keystone.gateway")

VALID_SIMULATED_STATUSES = {429, 500, 502, 503}


class AllProvidersUnavailableError(Exception):
    """Raised when every configured API key fails to produce a response."""


class _SimulatedProviderError(Exception):
    def __init__(self, key_id: str, status_code: int) -> None:
        super().__init__(f"Simulated HTTP {status_code} on {key_id}")
        self.key_id = key_id
        self.status_code = status_code


@dataclass
class GatewayResult:
    reply: str
    resolution_source: str  # "LIVE_INFERENCE" | "LLM_CACHE"
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    key_id: Optional[str]
    fallback_attempts: int


def parse_simulate_failure_header(header_value: Optional[str]) -> Dict[str, int]:
    """Parse X-Simulate-Failure header into {key_id_or_wildcard: status_code}.

    Supported formats:
      - key_1=429
      - key_1=429, key_2=500
      - *=429
    Valid status codes: 429, 500, 502, 503.
    """
    if not header_value:
        return {}

    parsed: Dict[str, int] = {}
    for segment in header_value.split(","):
        part = segment.strip()
        if not part or "=" not in part:
            continue
        raw_key, raw_status = part.split("=", 1)
        key_id = raw_key.strip().lower()
        status_str = raw_status.strip()
        if not key_id or not status_str.isdigit():
            continue
        status_code = int(status_str)
        if status_code in VALID_SIMULATED_STATUSES:
            parsed[key_id] = status_code
    return parsed


def _is_failover_exception(exc: Exception) -> bool:
    """Return True if the exception represents a retryable/failover provider error."""
    failover_types = tuple(
        t
        for t in (
            getattr(litellm, "RateLimitError", None),
            getattr(litellm, "InternalServerError", None),
            getattr(litellm, "ServiceUnavailableError", None),
            getattr(litellm, "BadGatewayError", None),
            getattr(litellm, "APIConnectionError", None),
            getattr(litellm, "Timeout", None),
            getattr(litellm, "AuthenticationError", None),
            getattr(litellm, "PermissionDeniedError", None),
            getattr(litellm, "APIError", None),
        )
        if t is not None
    )
    if isinstance(exc, failover_types):
        status_code = getattr(exc, "status_code", None)
        if status_code is None:
            return True
        if status_code in {401, 403, 408, 429} or status_code >= 500:
            return True
        # Check quota / rate limit wording in error string
        msg = str(exc).lower()
        if any(token in msg for token in ("quota", "rate limit", "429", "overloaded", "unavailable")):
            return True
        return False

    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and (status_code == 429 or status_code >= 500):
        return True
    return False


def _extract_reply_text(response: Any) -> str:
    choices = getattr(response, "choices", None)
    if choices is None and isinstance(response, dict):
        choices = response.get("choices")
    if not choices:
        return ""
    first = choices[0]
    message = getattr(first, "message", None)
    if message is None and isinstance(first, dict):
        message = first.get("message")
    if message is None:
        return ""
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    return content.strip() if isinstance(content, str) else ""


def _extract_token_usage(
    response: Any,
    model: str,
    messages: List[Dict[str, str]],
    reply: str,
) -> Tuple[int, int]:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")

    prompt_tokens = None
    completion_tokens = None

    if usage is not None:
        prompt_tokens = getattr(usage, "prompt_tokens", None)
        completion_tokens = getattr(usage, "completion_tokens", None)
        if prompt_tokens is None and isinstance(usage, dict):
            prompt_tokens = usage.get("prompt_tokens")
        if completion_tokens is None and isinstance(usage, dict):
            completion_tokens = usage.get("completion_tokens")

    if prompt_tokens is None:
        try:
            prompt_tokens = int(litellm.token_counter(model=model, messages=messages))
        except Exception:
            prompt_tokens = max(1, sum(len(m["content"].split()) for m in messages))

    if completion_tokens is None:
        try:
            completion_tokens = int(litellm.token_counter(model=model, text=reply))
        except Exception:
            completion_tokens = max(1, len(reply.split()))

    return max(0, int(prompt_tokens)), max(0, int(completion_tokens))


def _is_cache_hit(response: Any) -> bool:
    hidden = getattr(response, "_hidden_params", None)
    if isinstance(hidden, dict) and hidden.get("cache_hit") is True:
        return True
    if isinstance(response, dict):
        hidden_dict = response.get("_hidden_params")
        if isinstance(hidden_dict, dict) and hidden_dict.get("cache_hit") is True:
            return True
    return False


class LLMGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.key_pool: List[KeyEntry] = list(settings.key_pool)
        self.cache_enabled = settings.cache_enabled
        self._configure_litellm()

    def _configure_litellm(self) -> None:
        # Keep LiteLLM quiet and clean; prevent noisy telemetry or automatic silent retries
        # so our deterministic key pool controls failover explicitly.
        litellm.suppress_debug_info = True
        litellm.set_verbose = False
        litellm.drop_params = True

        if self.cache_enabled:
            if self.settings.cache_type == "disk":
                os.makedirs(self.settings.cache_dir, exist_ok=True)
                litellm.cache = Cache(type="disk", disk_cache_dir=self.settings.cache_dir)
            else:
                litellm.cache = Cache(type="local")
        else:
            litellm.cache = None

    def clear_cache(self) -> None:
        """Reset LiteLLM cache (useful in tests)."""
        if self.cache_enabled:
            self._configure_litellm()

    def complete(
        self,
        messages: List[Dict[str, str]],
        simulate_failure_header: Optional[str] = None,
    ) -> GatewayResult:
        if not self.key_pool:
            raise AllProvidersUnavailableError("No API keys configured")

        simulated_failures: Dict[str, int] = {}
        if self.settings.enable_failure_simulation and simulate_failure_header:
            simulated_failures = parse_simulate_failure_header(simulate_failure_header)

        # Bypass cache when failure simulation is active so failover is exercised deterministically.
        use_cache = self.cache_enabled and not bool(simulated_failures)

        start = time.perf_counter()
        fallback_attempts = 0

        for entry in self.key_pool:
            sim_status = simulated_failures.get("*") or simulated_failures.get(entry.key_id.lower())
            if sim_status is not None:
                logger.warning(
                    "Simulated failure triggered for %s (status=%s); advancing key pool",
                    entry.key_id,
                    sim_status,
                )
                fallback_attempts += 1
                continue

            try:
                call_kwargs: Dict[str, Any] = {
                    "model": entry.model,
                    "messages": messages,
                    "api_key": entry.api_key,
                    "timeout": self.settings.llm_timeout_seconds,
                    "num_retries": 0,
                    "caching": use_cache,
                }
                if not use_cache:
                    call_kwargs["cache"] = {"no-cache": True, "no-store": True}

                response = litellm.completion(**call_kwargs)
                reply = _extract_reply_text(response)
                if not reply:
                    logger.warning("Empty reply from %s (%s); failing over", entry.key_id, entry.model)
                    fallback_attempts += 1
                    continue

                elapsed_ms = int(round((time.perf_counter() - start) * 1000))
                cache_hit = use_cache and _is_cache_hit(response)
                input_tokens, output_tokens = _extract_token_usage(
                    response=response,
                    model=entry.model,
                    messages=messages,
                    reply=reply,
                )

                return GatewayResult(
                    reply=reply,
                    resolution_source="LLM_CACHE" if cache_hit else "LIVE_INFERENCE",
                    model=entry.model,
                    latency_ms=max(0, elapsed_ms),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    key_id=None if cache_hit else entry.key_id,
                    fallback_attempts=0 if cache_hit else fallback_attempts,
                )

            except Exception as exc:
                if _is_failover_exception(exc):
                    logger.warning(
                        "Provider failure on %s (%s): %s; failing over",
                        entry.key_id,
                        entry.model,
                        type(exc).__name__,
                    )
                    fallback_attempts += 1
                    continue

                # Any other provider-level failure also fails over safely instead of crashing
                logger.error(
                    "Unexpected provider error on %s (%s): %s; failing over",
                    entry.key_id,
                    entry.model,
                    type(exc).__name__,
                )
                fallback_attempts += 1
                continue

        raise AllProvidersUnavailableError("all providers unavailable")
