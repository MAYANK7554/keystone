from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer


class HealthResponse(BaseModel):
    status: Literal["ok"]
    keys_configured: int
    cache_enabled: bool


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: str = Field(..., description="Client-generated session identifier (1-128 chars)")
    message: str = Field(..., description="User message (1-4000 chars after trimming)")
    system_prompt: Optional[str] = Field(
        default=None,
        description="Optional system prompt override for this session",
    )

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed or len(trimmed) > 128:
            raise ValueError("session_id must be between 1 and 128 characters")
        return trimmed

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("message cannot be empty")
        if len(trimmed) > 4000:
            raise ValueError("message must be at most 4000 characters after trimming")
        return trimmed

    @field_validator("system_prompt")
    @classmethod
    def validate_system_prompt(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        if len(trimmed) > 4000:
            raise ValueError("system_prompt must be at most 4000 characters")
        return trimmed if trimmed else None


class ChatMetadata(BaseModel):
    resolution_source: Literal["LIVE_INFERENCE", "LLM_CACHE"]
    model: str
    latency_ms: int = Field(..., ge=0)
    input_tokens: int = Field(..., ge=0)
    output_tokens: int = Field(..., ge=0)
    key_id: Optional[str] = None
    fallback_attempts: int = Field(..., ge=0)


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    metadata: ChatMetadata


class SessionMessageItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    metadata: Optional[Dict[str, Any]] = None

    @model_serializer
    def serialize_item(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "role": self.role,
            "content": self.content,
        }
        if self.metadata is not None:
            data["metadata"] = self.metadata
        return data


class SessionMessagesResponse(BaseModel):
    session_id: str
    messages: List[SessionMessageItem]
