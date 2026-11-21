import { useState } from 'react';
import type { HealthResponse, SessionTab } from '../types';

interface SidebarProps {
  sessionId: string;
  sessions: SessionTab[];
  systemPrompt: string;
  simulateFailure: string;
  health: HealthResponse | null;
  healthError: string | null;
  syncing: boolean;
  stats: {
    total: number;
    cacheHits: number;
    failovers: number;
    avgLiveMs: number | null;
    avgCacheMs: number | null;
  };
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSyncSession: () => void;
  onSystemPromptChange: (val: string) => void;
  onSimulateFailureChange: (val: string) => void;
  onRefreshHealth: () => void;
}

const SYSTEM_PRESETS = [
  { label: 'Concise', value: 'Reply concisely in 1-2 short sentences.' },
  { label: 'Engineer', value: 'You are a pragmatic staff software engineer. Be direct and technical.' },
  { label: 'Pirate', value: 'Answer clearly, but speak like a seasoned pirate captain.' },
];

const FAILURE_PRESETS = [
  { label: 'Normal', sub: 'No fault', value: '' },
  { label: 'key_1=429', sub: 'Rate limit → key_2', value: 'key_1=429' },
  { label: 'key_1=500', sub: '5xx fault → key_2', value: 'key_1=500' },
  { label: '*=429', sub: 'All fail → 503', value: '*=429' },
];

export default function Sidebar({
  sessionId,
  sessions,
  systemPrompt,
  simulateFailure,
  health,
  healthError,
  syncing,
  stats,
  onNewSession,
  onSelectSession,
  onSyncSession,
  onSystemPromptChange,
  onSimulateFailureChange,
  onRefreshHealth,
}: SidebarProps) {
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1200);
    } catch {
      // Clipboard unavailable
    }
  };

  const hitRate =
    stats.total > 0 ? Math.round((stats.cacheHits / stats.total) * 100) : 0;

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-zinc-800 bg-[#18181b] text-zinc-100">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Session Controls */}
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Session
            </span>
            <button
              type="button"
              onClick={handleCopyId}
              className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
              title="Copy session ID"
            >
              {copiedId ? 'copied' : sessionId}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onNewSession}
              className="rounded-lg bg-teal-600 px-2.5 py-2 text-xs font-medium text-white transition hover:bg-teal-500"
            >
              + New Session
            </button>
            <button
              type="button"
              onClick={onSyncSession}
              disabled={syncing}
              className="rounded-lg border border-zinc-700 bg-zinc-800/90 px-2.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync SQLite'}
            </button>
          </div>

          {sessions.length > 0 && (
            <div className="mt-3.5 space-y-0.5">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Recent
              </div>
              {sessions.slice(0, 5).map((s) => {
                const active = s.id === sessionId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectSession(s.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                      active
                        ? 'bg-zinc-800 font-medium text-white'
                        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                    }`}
                  >
                    <span className="truncate">{s.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {s.id.slice(0, 8)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* System Prompt */}
        <section className="border-t border-zinc-800 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <label
              htmlFor="system-prompt-input"
              className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400"
            >
              System Prompt
            </label>
            {systemPrompt && (
              <button
                type="button"
                onClick={() => onSystemPromptChange('')}
                className="font-mono text-[10px] text-zinc-400 hover:text-white"
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
            placeholder="Optional instructions override for this session…"
            className="w-full resize-none rounded-lg border border-zinc-700/80 bg-[#121215] px-2.5 py-2 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-teal-500 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SYSTEM_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onSystemPromptChange(preset.value)}
                className="rounded-md border border-zinc-700/80 bg-zinc-800/70 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        {/* Failover Simulator */}
        <section className="border-t border-zinc-800 pt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Failover Simulator
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                simulateFailure.trim()
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {simulateFailure.trim() ? 'Armed' : 'Off'}
            </span>
          </div>
          <p className="mb-2.5 text-[11px] leading-snug text-zinc-400">
            Sends <code className="font-mono text-zinc-200">X-Simulate-Failure</code> per request.
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            {FAILURE_PRESETS.map((preset) => {
              const selected = simulateFailure.trim() === preset.value;
              const isFault = preset.value !== '';
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onSimulateFailureChange(preset.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                    selected && isFault
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                      : selected
                      ? 'border-teal-500 bg-teal-600/20 text-white'
                      : 'border-zinc-800 bg-[#202024] text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                  }`}
                >
                  <div className="font-mono text-[11px] font-medium">{preset.label}</div>
                  <div
                    className={`text-[10px] ${
                      selected && !isFault
                        ? 'text-teal-200'
                        : selected && isFault
                        ? 'text-amber-300'
                        : 'text-zinc-500'
                    }`}
                  >
                    {preset.sub}
                  </div>
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={simulateFailure}
            onChange={(e) => onSimulateFailureChange(e.target.value)}
            placeholder="Custom e.g. key_1=429, key_2=503"
            className="mt-2 w-full rounded-lg border border-zinc-700/80 bg-[#121215] px-2.5 py-1.5 font-mono text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-teal-500 focus:outline-none"
          />
        </section>
      </div>

      {/* Gateway Health Footer */}
      <div className="border-t border-zinc-800 bg-[#141417] px-4 py-3 font-mono text-[11px] tabular-nums">
        <div className="mb-2 flex items-center justify-between">
          <span className="uppercase tracking-wider text-zinc-400">Gateway Health</span>
          <button
            type="button"
            onClick={onRefreshHealth}
            className="text-zinc-400 transition hover:text-white"
            title="Refresh /health"
          >
            Refresh
          </button>
        </div>

        {healthError ? (
          <div className="rounded-md border border-red-900/70 bg-red-950/50 px-2.5 py-1.5 text-[11px] text-red-300">
            {healthError}
          </div>
        ) : (
          <div className="space-y-1 text-zinc-400">
            <div className="flex justify-between">
              <span>Key pool</span>
              <span className="font-medium text-zinc-100">
                {health ? `${health.keys_configured} active` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cache</span>
              <span className="font-medium text-emerald-400">
                {health ? (health.cache_enabled ? 'Enabled' : 'Disabled') : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Hit rate</span>
              <span className="font-medium text-zinc-100">
                {stats.cacheHits}/{stats.total} ({hitRate}%)
              </span>
            </div>
            <div className="flex justify-between border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-500">
              <span>live {stats.avgLiveMs !== null ? `${stats.avgLiveMs}ms` : '—'}</span>
              <span>cache {stats.avgCacheMs !== null ? `${stats.avgCacheMs}ms` : '—'}</span>
              <span>failover {stats.failovers}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
