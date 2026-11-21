import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Check,
  Clock,
  Copy,
  Cpu,
  Database,
  KeyRound,
  ShieldAlert,
  User,
  Zap,
} from 'lucide-react';
import type { ChatMessage } from '../types';
import { MarkdownContent } from './MarkdownContent';

interface MessageItemProps {
  message: ChatMessage;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  if (message.role === 'user') {
    return (
      <div className="animate-message-in group flex justify-end gap-3">
        <div className="flex max-w-[82%] flex-col items-end gap-1">
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-br from-indigo-600 to-indigo-500 px-4 py-3 text-[14.5px] leading-relaxed text-white shadow-lg shadow-indigo-950/30 ring-1 ring-white/10 whitespace-pre-wrap break-words">
            {message.content}
          </div>
          {message.timestamp && (
            <span className="px-1 font-mono text-[10px] text-zinc-500 opacity-0 transition group-hover:opacity-100">
              {message.timestamp}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/25">
          <User className="h-4 w-4" />
        </div>
      </div>
    );
  }

  const meta = message.metadata;
  const isCache = meta?.resolution_source === 'LLM_CACHE';
  const hadFailover = (meta?.fallback_attempts ?? 0) > 0;

  return (
    <div className="animate-message-in group flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ${
          isCache
            ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25'
            : 'bg-zinc-900 text-indigo-400 ring-white/[0.1]'
        }`}
      >
        <Bot className="h-4 w-4" />
      </div>

      {/* Required contract container: data-testid="assistant-message" */}
      <div
        data-testid="assistant-message"
        className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-md border border-white/[0.08] bg-[#111114] shadow-xl shadow-black/30"
      >
        {/* Top Response Header */}
        <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.015] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300">Assistant</span>
            {message.timestamp && (
              <span className="font-mono text-[10px] text-zinc-500">
                {message.timestamp}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleCopy()}
            title="Copy response"
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Rendered Reply Content */}
        <div className="px-4 py-3.5">
          <MarkdownContent content={message.content} />
        </div>

        {/* Structured Request Telemetry Bar */}
        {meta && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] bg-[#0c0c0f] px-4 py-2.5 font-mono text-[11px]">
            {/* Resolution Source: EXACT text LIVE_INFERENCE or LLM_CACHE */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold tracking-tight ring-1 ${
                isCache
                  ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                  : 'bg-sky-500/15 text-sky-300 ring-sky-500/30'
              }`}
            >
              {isCache ? (
                <Database className="h-3 w-3 text-emerald-400" />
              ) : (
                <Zap className="h-3 w-3 text-sky-400" />
              )}
              <span data-testid="meta-source">{meta.resolution_source}</span>
            </span>

            {/* Model */}
            <span
              title="Model that produced this reply"
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-zinc-300 ring-1 ring-white/[0.07]"
            >
              <Cpu className="h-3 w-3 text-zinc-500" />
              <span data-testid="meta-model">{meta.model}</span>
            </span>

            {/* Latency */}
            <span
              title="Server-measured latency for this request"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ring-1 ${
                isCache
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20'
                  : 'bg-white/[0.04] text-zinc-300 ring-white/[0.07]'
              }`}
            >
              <Clock className="h-3 w-3 opacity-70" />
              <span data-testid="meta-latency">{meta.latency_ms} ms</span>
            </span>

            {/* Per-request Token Usage */}
            <span
              title="Per-request prompt and completion tokens"
              className="inline-flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-0.5 text-zinc-300 ring-1 ring-white/[0.07]"
            >
              <span className="inline-flex items-center gap-0.5">
                <ArrowUpRight className="h-3 w-3 text-zinc-500" />
                <span className="text-zinc-500">in</span>
                <span data-testid="meta-input-tokens" className="ml-0.5 font-semibold text-zinc-200">
                  {meta.input_tokens}
                </span>
              </span>
              <span className="text-zinc-700">/</span>
              <span className="inline-flex items-center gap-0.5">
                <ArrowDownLeft className="h-3 w-3 text-zinc-500" />
                <span className="text-zinc-500">out</span>
                <span data-testid="meta-output-tokens" className="ml-0.5 font-semibold text-zinc-200">
                  {meta.output_tokens}
                </span>
              </span>
            </span>

            {/* Key ID (observability) */}
            <span
              title={meta.key_id ? `Served by ${meta.key_id}` : 'Served from cache (no API key consumed)'}
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.03] px-2 py-0.5 text-zinc-400 ring-1 ring-white/[0.06]"
            >
              <KeyRound className="h-3 w-3 text-zinc-500" />
              <span>{meta.key_id ?? 'cache'}</span>
            </span>

            {/* Failover Badge */}
            {hadFailover && (
              <span
                title="Number of failed keys bypassed before succeeding"
                className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300 ring-1 ring-amber-500/35"
              >
                <ShieldAlert className="h-3 w-3 text-amber-400" />
                <span>failover ×{meta.fallback_attempts}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
