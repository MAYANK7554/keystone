from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, load_settings
from app.database import Database
from app.llm_gateway import AllProvidersUnavailableError, LLMGateway
from app.schemas import (
    ChatMetadata,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SessionMessageItem,
    SessionMessagesResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("keystone.api")


def create_app(settings_override: Optional[Settings] = None) -> FastAPI:
    settings = settings_override or load_settings()
    db = Database(settings.database_url)
    gateway = LLMGateway(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        db.init_db()
        logger.info(
            "Backend started: keys_configured=%d cache_enabled=%s failure_simulation=%s db=%s",
            len(settings.key_pool),
            settings.cache_enabled,
            settings.enable_failure_simulation,
            db.db_path,
        )
        yield
        db.close()

    app = FastAPI(
        title="Keystone Resilient LLM Gateway API",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.state.settings = settings
    app.state.db = db
    app.state.gateway = gateway

    allow_credentials = "*" not in settings.allowed_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = []
        for err in exc.errors():
            clean = dict(err)
            if isinstance(clean.get("ctx"), dict):
                clean["ctx"] = {k: str(v) for k, v in clean["ctx"].items()}
            errors.append(clean)
        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(errors)},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", type(exc).__name__)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "internal server error"},
        )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        if not db.ping():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="database unavailable",
            )
        if not settings.key_pool:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="no API keys configured",
            )
        return HealthResponse(
            status="ok",
            keys_configured=len(settings.key_pool),
            cache_enabled=settings.cache_enabled,
        )

    @app.post("/chat", response_model=ChatResponse)
    def chat(
        payload: ChatRequest,
        x_simulate_failure: Optional[str] = Header(default=None, alias="X-Simulate-Failure"),
    ) -> ChatResponse:
        # Resolve effective system prompt: request override -> persisted session prompt -> default
        stored_prompt = db.get_session_system_prompt(payload.session_id)
        effective_system_prompt = (
            payload.system_prompt
            or stored_prompt
            or settings.default_system_prompt
        )

        # Build full LLM message context: system prompt + stored history + new user message
        history = db.get_session_messages(payload.session_id)
        llm_messages: List[Dict[str, str]] = []
        if effective_system_prompt:
            llm_messages.append({"role": "system", "content": effective_system_prompt})
        for msg in history:
            llm_messages.append({"role": msg["role"], "content": msg["content"]})
        llm_messages.append({"role": "user", "content": payload.message})

        try:
            result = gateway.complete(
                messages=llm_messages,
                simulate_failure_header=x_simulate_failure,
            )
        except AllProvidersUnavailableError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="all providers unavailable",
            )

        metadata = ChatMetadata(
            resolution_source=result.resolution_source,
            model=result.model,
            latency_ms=result.latency_ms,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            key_id=result.key_id,
            fallback_attempts=result.fallback_attempts,
        )

        # Persist turn only after a valid assistant reply has been obtained
        db.save_turn(
            session_id=payload.session_id,
            user_content=payload.message,
            assistant_content=result.reply,
            assistant_metadata=metadata.model_dump(),
            system_prompt=payload.system_prompt,
        )

        return ChatResponse(
            session_id=payload.session_id,
            reply=result.reply,
            metadata=metadata,
        )

    @app.get(
        "/sessions/{session_id}/messages",
        response_model=SessionMessagesResponse,
    )
    def get_session_messages(session_id: str) -> SessionMessagesResponse:
        messages = db.get_session_messages(session_id)
        if not messages:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="session not found",
            )
        return SessionMessagesResponse(
            session_id=session_id,
            messages=[SessionMessageItem(**m) for m in messages],
        )

    return app


app = create_app()
