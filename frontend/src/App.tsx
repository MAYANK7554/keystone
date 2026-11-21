import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Database,
  FlaskConical,
  Loader2,
  PanelLeft,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  ApiError,
  fetchHealth,
  fetchSessionMessages,
  sendChatMessage,
} from './api';
import { MessageItem } from './components/MessageItem';
import { Sidebar } from './components/Sidebar';
import type { ChatMessage, HealthStatus, SessionSummary } from './types';

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `s-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `s-${Math.random().toString(36).slice(2, 10)}`;
}

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STARTER_CARDS = [
  {
    title: 'Test Live + Cache Hit',
    subtitle: 'Send once, then click New Session & send again',
    prompt: 'What is the capital of France?',
    tag: 'CACHE',
  },
  {
    title: 'Multi-Turn Context',
    subtitle: 'Stores turn in SQLite for follow-up recall',
    prompt: 'Remember that my project codename is Orion and launch is Friday.',
    tag: 'MEMORY',
  },
  {
    title: 'Recall Context',
    subtitle: 'Ask right after setting your codename',
    prompt: 'What is my project codename and when is the launch?',
    tag: 'SQLITE',
  },
  {
    title: 'Technical Explanation',
    subtitle: 'Verify markdown formatting & token counts',
    prompt: 'Explain API key failover vs response caching in 3 crisp bullet points.',
    tag: 'TOKENS',
  },
];

interface ErrorState {
  status?: number;
  message: string;
  failedPrompt?: string;
}

export default function App() {
  // Always start a brand-new session on every page load (per spec)
  const [sessionId, setSessionId] = useState<string>(() => createSessionId());
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>(() => [
    { id: '', label: 'Current session', turnCount: 0 },
  ]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [simulateFailure, setSimulateFailure] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync initial sessionId into recentSessions once mounted
  useEffect(() => {
    setRecentSessions([{ id: sessionId, label: 'New session', turnCount: 0 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const status = await fetchHealth();
      setHealth(status);
      setHealthError(null);
    } catch (err) {
      setHealth(null);
      setHealthError(
        err instanceof Error ? err.message : 'Unable to reach backend /health',
      );
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, errorState]);

  // Auto-resize composer textarea cleanly up to 160px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleNewSession = () => {
    const freshId = createSessionId();
    setSessionId(freshId);
    setMessages([]);
    setErrorState(null);
    setRecentSessions((prev) => [
      { id: freshId, label: 'New session', turnCount: 0 },
      ...prev.filter((s) => s.id && s.id !== freshId),
    ]);
    textareaRef.current?.focus();
  };

  const loadSessionFromBackend = async (targetSessionId: string) => {
    setErrorState(null);
    try {
      const history = await fetchSessionMessages(targetSessionId);
      setSessionId(targetSessionId);
      setMessages(
        history.messages.map((m, idx) => ({
          id: `${targetSessionId}-${idx}`,
          role: m.role,
          content: m.content,
          metadata: m.metadata,
        })),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        if (targetSessionId !== sessionId) {
          setSessionId(targetSessionId);
          setMessages([]);
        } else {
          setErrorState({
            status: 404,
            message: 'No turns have been persisted to SQLite for this session yet.',
          });
        }
      } else {
        setErrorState({
          status: err instanceof ApiError ? err.status : undefined,
          message:
            err instanceof Error ? err.message : 'Could not load session history.',
        });
      }
    }
  };

  const submitMessage = async (textOverride?: string) => {
    const rawText = textOverride ?? input;
    const trimmed = rawText.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setErrorState(null);
    setInput('');
    setIsLoading(true);

    const optimisticUserId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: optimisticUserId,
      role: 'user',
      content: trimmed,
      timestamp: nowTimeLabel(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await sendChatMessage({
        sessionId,
        message: trimmed,
        systemPrompt: systemPrompt.trim() || undefined,
        simulateFailure: simulateFailure.trim() || undefined,
      });

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        timestamp: nowTimeLabel(),
        metadata: res.metadata,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Update recent session label on first successful turn
      setRecentSessions((prev) => {
        const exists = prev.some((s) => s.id === sessionId);
        const shortLabel = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
        if (!exists) {
          return [{ id: sessionId, label: shortLabel, turnCount: 1 }, ...prev];
        }
        return prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                label: s.turnCount === 0 ? shortLabel : s.label,
                turnCount: s.turnCount + 1,
              }
            : s,
        );
      });
    } catch (err) {
      // Failed requests (422/503) are never persisted on backend; remove optimistic bubble
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserId));

      if (err instanceof ApiError) {
        setErrorState({
          status: err.status,
          message: err.detail,
          failedPrompt: trimmed,
        });
      } else {
        setErrorState({
          message:
            err instanceof Error
              ? `Network error: ${err.message}`
              : 'An unexpected network error occurred.',
          failedPrompt: trimmed,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitMessage();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#09090b] text-zinc-100">
      {/* Top Command Bar */}
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#09090b]/90 px-4 backdrop-blur-md sm:px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] lg:hidden"
            aria-label="Open inspector"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-950/50 ring-1 ring-white/15">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold tracking-tight text-white">
                  Keystone
                </h1>
                <span className="hidden rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
                  LLM Gateway
                </span>
              </div>
              <p className="hidden text-[11px] text-zinc-500 sm:block">
                Key Pool Failover · LiteLLM Response Cache · SQLite Sessions
              </p>
            </div>
          </div>
        </div>

        {/* Right Header Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNewSession}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden sm:inline">New Chat</span>
          </button>

          <button
            type="button"
            onClick={() => void loadHealth()}
            title="Backend /health status (click to refresh)"
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
              health
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25 hover:bg-emerald-500/15'
                : 'bg-rose-500/10 text-rose-300 ring-rose-500/25 hover:bg-rose-500/15'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {health && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  health ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
            </span>
            <span className="hidden sm:inline">
              {health ? `${health.keys_configured} Keys Ready` : 'Offline'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessionId={sessionId}
          recentSessions={recentSessions}
          onSelectSession={(id) => void loadSessionFromBackend(id)}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
          simulateFailure={simulateFailure}
          onSimulateFailureChange={setSimulateFailure}
          onNewSession={handleNewSession}
          onReloadHistory={() => void loadSessionFromBackend(sessionId)}
          health={health}
          healthError={healthError}
          isCheckingHealth={isCheckingHealth}
          onRefreshHealth={() => void loadHealth()}
          messages={messages}
          isLoading={isLoading}
          mobileOpen={mobileDrawerOpen}
          onCloseMobile={() => setMobileDrawerOpen(false)}
        />

        {/* Chat Canvas + Composer */}
        <main className="relative flex min-h-0 flex-1 flex-col bg-[#09090b]">
          {/* Subtle top ambient glow */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-indigo-500/[0.04] to-transparent" />

          {/* Scrollable Messages Area */}
          <div className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {/* Empty State Studio Hero */}
              {messages.length === 0 && !errorState && (
                <div className="bg-grid-subtle my-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e0e12]/80 p-6 sm:p-8">
                  <div className="mx-auto max-w-xl text-center">
                    <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium text-indigo-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Resilient Multi-Key AI Gateway
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                      Fault-tolerant chat with instant caching
                    </h2>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400 sm:text-sm">
                      Every assistant reply surfaces its exact resolution path, model, server latency, and per-request token usage—backed by SQLite session memory and automatic key failover.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-400">
                      <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1">
                        <Zap className="h-3 w-3 text-sky-400" />
                        Auto-Failover (429 / 5xx)
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1">
                        <Database className="h-3 w-3 text-emerald-400" />
                        Cross-Session Cache
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1">
                        <FlaskConical className="h-3 w-3 text-amber-400" />
                        Live Fault Injection
                      </span>
                    </div>
                  </div>

                  {/* Interactive Starter Cards */}
                  <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {STARTER_CARDS.map((card) => (
                      <button
                        key={card.title}
                        type="button"
                        onClick={() => void submitMessage(card.prompt)}
                        className="group flex flex-col items-start rounded-xl border border-white/[0.07] bg-[#111115]/90 p-3.5 text-left transition hover:border-indigo-500/40 hover:bg-[#15151b]"
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-100 group-hover:text-white">
                            {card.title}
                          </span>
                          <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-400 group-hover:bg-indigo-500/15 group-hover:text-indigo-300">
                            {card.tag}
                          </span>
                        </div>
                        <span className="mt-1 text-[11px] text-zinc-500">
                          {card.subtitle}
                        </span>
                        <span className="mt-2 line-clamp-1 font-mono text-[11px] text-zinc-400 group-hover:text-zinc-300">
                          “{card.prompt}”
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message Thread */}
              {messages.map((msg) => (
                <MessageItem key={msg.id} message={msg} />
              ))}

              {/* In-flight Shimmer Card */}
              {isLoading && (
                <div className="animate-message-in flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-indigo-400 ring-1 ring-white/[0.08]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                  <div className="flex-1 rounded-2xl rounded-tl-md border border-white/[0.07] bg-[#111114] p-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span>Routing through LiteLLM gateway</span>
                      {simulateFailure && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 ring-1 ring-amber-500/30">
                          X-Simulate-Failure: {simulateFailure}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-white/[0.04]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Readable Error Card (422 / 503 / Network) */}
              {errorState && (
                <div
                  role="alert"
                  className="animate-message-in overflow-hidden rounded-xl border border-rose-500/30 bg-rose-950/25 shadow-lg shadow-rose-950/20"
                >
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-rose-100">
                            Request could not be completed
                          </span>
                          {errorState.status && (
                            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-200 ring-1 ring-rose-500/30">
                              HTTP {errorState.status}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-rose-200/90">
                          {errorState.message}
                        </p>
                        {(errorState.status === 422 || errorState.status === 503) && (
                          <p className="mt-1.5 font-mono text-[10.5px] text-rose-300/70">
                            Session integrity preserved: failed turn was not saved to SQLite.
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setErrorState(null)}
                      className="rounded-lg p-1 text-rose-300/80 transition hover:bg-rose-500/20 hover:text-rose-100"
                      aria-label="Dismiss error"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {errorState.failedPrompt && (
                    <div className="flex items-center justify-end border-t border-rose-500/15 bg-rose-950/20 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => void submitMessage(errorState.failedPrompt)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-100 transition hover:bg-rose-500/30"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry message
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Floating Command Composer */}
          <div className="shrink-0 border-t border-white/[0.07] bg-[#09090b]/95 px-4 py-3.5 backdrop-blur sm:px-8">
            <div className="mx-auto max-w-3xl">
              {/* Active Failure Simulation Warning Strip */}
              {simulateFailure.trim() && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                  <span className="flex items-center gap-1.5 font-mono text-[11px]">
                    <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
                    Sending header: <strong>X-Simulate-Failure: {simulateFailure.trim()}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSimulateFailure('')}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20"
                  >
                    Disable
                  </button>
                </div>
              )}

              <form
                onSubmit={handleSubmit}
                className="relative flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-[#111114] p-2 shadow-xl shadow-black/40 transition focus-within:border-indigo-500/60 focus-within:ring-2 focus-within:ring-indigo-500/20"
              >
                <textarea
                  ref={textareaRef}
                  data-testid="chat-input"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything... (Enter to send, Shift+Enter for new line)"
                  disabled={isLoading}
                  maxLength={4000}
                  className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14.5px] leading-relaxed text-zinc-100 placeholder-zinc-500 focus:outline-none disabled:opacity-60"
                />

                <button
                  type="submit"
                  data-testid="send-button"
                  disabled={isLoading || !input.trim()}
                  aria-label="Send message"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                  )}
                </button>
              </form>

              <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-zinc-500">
                <span>
                  Session <code className="font-mono text-zinc-400">{sessionId}</code>
                  {systemPrompt.trim() ? ' · Custom system prompt active' : ''}
                </span>
                <span
                  className={`font-mono ${
                    input.length > 3600 ? 'text-amber-400' : 'text-zinc-500'
                  }`}
                >
                  {input.length.toLocaleString()} / 4,000
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
