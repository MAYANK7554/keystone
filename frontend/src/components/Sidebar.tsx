import React, { useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  FlaskConical,
  Gauge,
  History,
  Layers,
  Plus,
  RefreshCw,
  Sliders,
  X,
} from 'lucide-react';
import type { ChatMessage, HealthStatus, SessionSummary } from '../types';

interface SidebarProps {
  sessionId: string;
  recentSessions: SessionSummary[];
  onSelectSession: (id: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  simulateFailure: string;
  onSimulateFailureChange: (value: string) => void;
  onNewSession: () => void;
  onReloadHistory: () => void;
  health: HealthStatus | null;
  healthError: string | null;
  isCheckingHealth: boolean;
  onRefreshHealth: () => void;
  messages: ChatMessage[];
  isLoading: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const FAILURE_PRESETS = [
  { label: 'Normal', sub: 'No fault', value: '' },
  { label: 'key_1=429', sub: 'Rate limit → key_2', value: 'key_1=429' },
  { label: 'key_1=500', sub: '5xx fault → key_2', value: 'key_1=500' },
  { label: '*=429', sub: 'All fail → 503', value: '*=429' },
];

const SYSTEM_PRESETS = [
  { label: 'Concise', value: 'Answer in at most two crisp sentences.' },
  { label: 'Engineer', value: 'You are a senior distributed systems engineer. Be direct and technical.' },
  { label: 'Pirate', value: 'Always respond briefly in playful pirate speak.' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  sessionId,
  recentSessions,
  onSelectSession,
  systemPrompt,
  onSystemPromptChange,
  simulateFailure,
  onSimulateFailureChange,
  onNewSession,
  onReloadHistory,
  health,
  healthError,
  isCheckingHealth,
  onRefreshHealth,
  messages,
  isLoading,
  mobileOpen,
  onCloseMobile,
}) => {
  const [copiedId, setCopiedId] = useState(false);

  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.metadata);
  const totalReplies = assistantMessages.length;
  const cacheHits = assistantMessages.filter(
    (m) => m.metadata?.resolution_source === 'LLM_CACHE',
  ).length;
  const liveReplies = assistantMessages.filter(
    (m) => m.metadata?.resolution_source === 'LIVE_INFERENCE',
  );
  const cacheReplies = assistantMessages.filter(
    (m) => m.metadata?.resolution_source === 'LLM_CACHE',
  );
  const failovers = assistantMessages.reduce(
    (acc, m) => acc + (m.metadata?.fallback_attempts ?? 0),
    0,
  );
  const cacheRate = totalReplies > 0 ? Math.round((cacheHits / totalReplies) * 100) : 0;
  const avgLiveMs =
    liveReplies.length > 0
      ? Math.round(
          liveReplies.reduce((sum, m) => sum + (m.metadata?.latency_ms ?? 0), 0) /
            liveReplies.length,
        )
      : null;
  const avgCacheMs =
    cacheReplies.length > 0
      ? Math.round(
          cacheReplies.reduce((sum, m) => sum + (m.metadata?.latency_ms ?? 0), 0) /
            cacheReplies.length,
        )
      : null;

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // ignore
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col gap-5 overflow-y-auto bg-[#0c0c0f] p-4">
      {/* Mobile Header */}
      <div className="flex items-center justify-between lg:hidden">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Gateway Inspector
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Session Controls */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            Session
          </span>
          <button
            type="button"
            onClick={() => void copySessionId()}
            title="Copy session_id"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-indigo-300 transition hover:border-indigo-500/40 hover:bg-indigo-500/10"
          >
            <span>{sessionId}</span>
            {copiedId ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 text-zinc-500" />
            )}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              onNewSession();
              onCloseMobile();
            }}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/40 transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New Session
          </button>
          <button
            type="button"
            onClick={onReloadHistory}
            disabled={isLoading}
            title="Re-fetch turns from GET /sessions/{session_id}/messages"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:opacity-50"
          >
            <History className="h-3.5 w-3.5 text-zinc-400" />
            Sync SQLite
          </button>
        </div>

        {/* Recent sessions created in this tab */}
        {recentSessions.length > 1 && (
          <div className="space-y-1 pt-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Recent in Tab
            </div>
            <div className="flex flex-col gap-1">
              {recentSessions.slice(0, 4).map((sess) => {
                const isActive = sess.id === sessionId;
                return (
                  <button
                    key={sess.id}
                    type="button"
                    disabled={isLoading || isActive}
                    onClick={() => {
                      onSelectSession(sess.id);
                      onCloseMobile();
                    }}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      isActive
                        ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/30'
                        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                    }`}
                  >
                    <span className="truncate pr-2">{sess.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {sess.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="h-px bg-white/[0.06]" />

      {/* System Prompt Studio */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="system-prompt-input"
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
          >
            <Sliders className="h-3.5 w-3.5 text-zinc-400" />
            System Prompt
          </label>
          {systemPrompt && (
            <button
              type="button"
              onClick={() => onSystemPromptChange('')}
              className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          )}
        </div>

        <textarea
          id="system-prompt-input"
          data-testid="system-prompt-input"
          rows={3}
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          placeholder="Optional instructions override for this session..."
          className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#09090b] px-3 py-2 text-xs leading-relaxed text-zinc-100 placeholder-zinc-600 transition focus:border-indigo-500/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />

        <div className="flex flex-wrap gap-1.5">
          {SYSTEM_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onSystemPromptChange(preset.value)}
              className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-0.5 text-[10.5px] text-zinc-400 transition hover:border-white/[0.16] hover:text-zinc-200"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </section>

      <div className="h-px bg-white/[0.06]" />

      {/* Failover Fault Injection Simulator */}
      <section className="space-y-2.5 rounded-xl border border-white/[0.07] bg-[#09090b] p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
            Failover Simulator
          </span>
          {simulateFailure ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              ARMED
            </span>
          ) : (
            <span className="font-mono text-[10px] text-zinc-500">OFF</span>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Injects <code className="rounded bg-white/[0.05] px-1 text-zinc-300">X-Simulate-Failure</code> per request to test automatic key pool failover.
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          {FAILURE_PRESETS.map((preset) => {
            const active = simulateFailure === preset.value;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onSimulateFailureChange(preset.value)}
                className={`flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition ring-1 ${
                  active
                    ? preset.value
                      ? 'bg-amber-500/15 text-amber-200 ring-amber-500/45'
                      : 'bg-white/[0.08] text-white ring-white/20'
                    : 'bg-white/[0.02] text-zinc-300 ring-white/[0.06] hover:bg-white/[0.05]'
                }`}
              >
                <span className="font-mono text-[11px] font-medium">{preset.label}</span>
                <span className="text-[9.5px] text-zinc-500">{preset.sub}</span>
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={simulateFailure}
          onChange={(e) => onSimulateFailureChange(e.target.value)}
          placeholder="Custom e.g. key_1=429, key_2=503"
          className="w-full rounded-lg border border-white/[0.08] bg-[#111114] px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none"
        />
      </section>

      {/* Session Telemetry & Gateway Health */}
      <section className="mt-auto space-y-3 rounded-xl border border-white/[0.07] bg-[#09090b] p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Gateway Health
          </span>
          <button
            type="button"
            onClick={onRefreshHealth}
            disabled={isCheckingHealth}
            title="Refresh GET /health"
            className="rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <RefreshCw className={`h-3 w-3 ${isCheckingHealth ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {health ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.05] bg-[#111114] px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Key Pool</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-emerald-300">
                {health.keys_configured} active
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.05] bg-[#111114] px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cache</div>
              <div className="mt-0.5 font-mono text-xs font-semibold text-sky-300">
                {health.cache_enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-300">
            {healthError || 'Checking /health...'}
          </div>
        )}

        {/* Session Performance Mini-Panel */}
        <div className="space-y-2 border-t border-white/[0.06] pt-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 text-zinc-400">
              <Gauge className="h-3 w-3 text-zinc-500" />
              Cache Hit Rate
            </span>
            <span className="font-mono font-semibold text-zinc-200">
              {cacheHits}/{totalReplies} ({cacheRate}%)
            </span>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
              style={{ width: `${cacheRate}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-1 pt-0.5 font-mono text-[10px] text-zinc-400">
            <div>
              <span className="text-zinc-500">live </span>
              {avgLiveMs !== null ? `${avgLiveMs}ms` : '—'}
            </div>
            <div className="text-center">
              <span className="text-zinc-500">cache </span>
              {avgCacheMs !== null ? `${avgCacheMs}ms` : '—'}
            </div>
            <div className="text-right">
              <span className="text-zinc-500">failover </span>
              <span className={failovers > 0 ? 'text-amber-300 font-semibold' : ''}>
                {failovers}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {/* Desktop Static Rail */}
      <aside className="hidden lg:block lg:w-[310px] lg:shrink-0 lg:border-r lg:border-white/[0.07]">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 h-full w-[300px] max-w-[85vw] border-r border-white/[0.08] shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};
