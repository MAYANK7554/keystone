import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, fetchHealth, fetchSessionMessages, sendChatMessage } from './api';
import MessageItem from './components/MessageItem';
import Sidebar from './components/Sidebar';
import type { ChatMessage, HealthResponse, SessionTab } from './types';

function createSessionId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `s-${hex}`;
}

const STARTER_PROMPTS = [
  {
    label: 'Cache Test',
    hint: 'Send once, then start a New Session and repeat',
    prompt: 'What is the capital of France?',
  },
  {
    label: 'Multi-Turn Memory',
    hint: 'Persists context to SQLite for follow-up recall',
    prompt: 'Remember that my project codename is Orion and the launch date is Friday.',
  },
  {
    label: 'Recall Context',
    hint: 'Test turn-2 memory right after setting codename',
    prompt: 'What is my project codename and when is the launch?',
  },
  {
    label: 'Architecture',
    hint: 'Inspect formatted markdown and token counts',
    prompt: 'Explain API key failover vs response caching in 3 bullet points.',
  },
];

export default function App() {
  const [sessionId, setSessionId] = useState<string>(() => createSessionId());
  const [sessions, setSessions] = useState<SessionTab[]>(() => []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [simulateFailure, setSimulateFailure] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
      setHealthError(null);
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Backend unreachable');
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const timer = window.setInterval(loadHealth, 30000);
    return () => window.clearInterval(timer);
  }, [loadHealth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const registerSessionTab = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const exists = prev.find((s) => s.id === id);
      if (exists) {
        return prev.map((s) =>
          s.id === id && s.title === 'New session' ? { ...s, title } : s
        );
      }
      return [{ id, title }, ...prev].slice(0, 10);
    });
  }, []);

  const handleNewSession = useCallback(() => {
    const nextId = createSessionId();
    setSessionId(nextId);
    setMessages([]);
    setSidebarOpen(false);
    inputRef.current?.focus();
  }, []);

  const handleSyncSession = useCallback(
    async (targetId?: string) => {
      const idToSync = targetId || sessionId;
      setSyncing(true);
      try {
        const res = await fetchSessionMessages(idToSync);
        const hydrated: ChatMessage[] = res.messages.map((m, idx) => ({
          id: `${idToSync}-${idx}`,
          role: m.role,
          content: m.content,
          metadata:
            m.role === 'assistant' && m.metadata
              ? {
                  resolution_source:
                    m.metadata.resolution_source === 'LLM_CACHE'
                      ? 'LLM_CACHE'
                      : 'LIVE_INFERENCE',
                  model: m.metadata.model ?? 'unknown',
                  latency_ms: m.metadata.latency_ms ?? 0,
                  input_tokens: m.metadata.input_tokens ?? 0,
                  output_tokens: m.metadata.output_tokens ?? 0,
                  key_id: m.metadata.key_id ?? null,
                  fallback_attempts: m.metadata.fallback_attempts ?? 0,
                }
              : undefined,
        }));
        setMessages(hydrated);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setMessages([]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'error',
              statusCode: err instanceof ApiError ? err.status : undefined,
              content:
                err instanceof Error ? err.message : 'Failed to load SQLite history',
            },
          ]);
        }
      } finally {
        setSyncing(false);
      }
    },
    [sessionId]
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      setSessionId(id);
      setSidebarOpen(false);
      void handleSyncSession(id);
    },
    [handleSyncSession]
  );

  const submitMessage = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || sending) return;

      setInput('');
      setSending(true);
      registerSessionTab(sessionId, trimmed.slice(0, 36));

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const res = await sendChatMessage({
          sessionId,
          message: trimmed,
          systemPrompt,
          simulateFailure,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: res.reply,
            metadata: res.metadata,
          },
        ]);
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.status : undefined;
        const detail =
          err instanceof Error ? err.message : 'Unexpected network error';
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'error',
            statusCode,
            content: detail,
          },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [registerSessionTab, sending, sessionId, simulateFailure, systemPrompt]
  );

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitMessage(input);
    }
  };

  const stats = useMemo(() => {
    const assistantMsgs = messages.filter(
      (m) => m.role === 'assistant' && m.metadata
    );
    const liveLatencies: number[] = [];
    const cacheLatencies: number[] = [];
    let cacheHits = 0;
    let failovers = 0;

    for (const m of assistantMsgs) {
      const meta = m.metadata!;
      if (meta.resolution_source === 'LLM_CACHE') {
        cacheHits += 1;
        cacheLatencies.push(meta.latency_ms);
      } else {
        liveLatencies.push(meta.latency_ms);
      }
      failovers += meta.fallback_attempts;
    }

    const avg = (arr: number[]) =>
      arr.length > 0
        ? Math.round(arr.reduce((sum, n) => sum + n, 0) / arr.length)
        : null;

    return {
      total: assistantMsgs.length,
      cacheHits,
      failovers,
      avgLiveMs: avg(liveLatencies),
      avgCacheMs: avg(cacheLatencies),
    };
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-[#f2f1ec] text-stone-900">
      {/* Grounded Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-[#141417] px-4 text-zinc-100">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-200 md:hidden"
          >
            Menu
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-white">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M2.5 3H17.5L14.5 17H5.5L2.5 3Z" fill="currentColor" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-white">
            KEYSTONE
          </span>
          <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">
            / LLM Gateway
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleNewSession}
            className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 hover:text-white"
          >
            + New Chat
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-200">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health ? 'bg-emerald-400' : 'bg-red-500'
              }`}
            />
            <span>
              {health ? `${health.keys_configured} Keys Ready` : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Charcoal Sidebar */}
        <div
          className={`${
            sidebarOpen ? 'absolute inset-y-0 left-0 z-20 block shadow-2xl' : 'hidden'
          } md:static md:block md:shadow-none`}
        >
          <Sidebar
            sessionId={sessionId}
            sessions={sessions}
            systemPrompt={systemPrompt}
            simulateFailure={simulateFailure}
            health={health}
            healthError={healthError}
            syncing={syncing}
            stats={stats}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onSyncSession={() => void handleSyncSession()}
            onSystemPromptChange={setSystemPrompt}
            onSimulateFailureChange={setSimulateFailure}
            onRefreshHealth={() => void loadHealth()}
          />
        </div>

        {/* Warm Stone Main Workspace */}
        <main className="flex min-w-0 flex-1 flex-col bg-[#f2f1ec]">
          <div className="flex-1 overflow-y-auto px-4 sm:px-8">
            <div className="mx-auto max-w-3xl py-8">
              {messages.length === 0 ? (
                <div className="pt-8 sm:pt-14">
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
                    KEYSTONE
                  </h1>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-stone-600">
                    Ordered API key failover, LiteLLM cross-session response caching, and SQLite conversation history—with full per-request telemetry on every turn.
                  </p>

                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    {STARTER_PROMPTS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => void submitMessage(item.prompt)}
                        className="group flex flex-col justify-between rounded-xl border border-stone-200/90 bg-white p-4 text-left shadow-sm transition hover:border-teal-600/60 hover:shadow"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                              {item.label}
                            </span>
                            <span className="font-mono text-xs text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-teal-700">
                              →
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-stone-500">{item.hint}</p>
                        </div>
                        <p className="mt-3 text-[13.5px] font-medium leading-snug text-stone-900">
                          “{item.prompt}”
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {messages.map((msg) => (
                    <MessageItem key={msg.id} message={msg} />
                  ))}
                  {sending && (
                    <div className="my-2.5 rounded-xl border border-stone-200/90 bg-white px-5 py-3.5 font-mono text-xs text-stone-500 shadow-sm">
                      Waiting for gateway response…
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-stone-200/90 bg-[#eae8e1] px-4 py-3.5 sm:px-8">
            <form onSubmit={handleFormSubmit} className="mx-auto max-w-3xl">
              {simulateFailure.trim() && (
                <div className="mb-2.5 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-mono text-[11px] text-amber-950">
                  <span>
                    X-Simulate-Failure: <strong>{simulateFailure.trim()}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSimulateFailure('')}
                    className="font-semibold text-amber-800 underline hover:text-amber-950"
                  >
                    Disable
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2 rounded-xl border border-stone-300 bg-white p-2 shadow-sm transition focus-within:border-teal-700">
                <textarea
                  ref={inputRef}
                  data-testid="chat-input"
                  rows={1}
                  maxLength={4000}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
                  className="max-h-36 min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="send-button"
                  disabled={sending || !input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white transition hover:bg-teal-800 disabled:bg-stone-200 disabled:text-stone-400"
                  aria-label="Send message"
                >
                  ↑
                </button>
              </div>

              <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-stone-500">
                <span>Session {sessionId}</span>
                <span>{input.length} / 4,000</span>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
