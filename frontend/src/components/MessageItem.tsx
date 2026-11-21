import { useState, type ReactNode } from 'react';
import type { ChatMessage } from '../types';

interface MessageItemProps {
  message: ChatMessage;
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          className="rounded border border-stone-200 bg-stone-100 px-1.5 py-0.5 font-mono text-[13px] text-stone-900"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-stone-950">
          {token.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{token}</span>;
  });
}

function renderMarkdown(content: string): ReactNode {
  const blocks = content.split(/(```[\s\S]*?```)/g);
  return blocks.map((block, bIdx) => {
    if (block.startsWith('```') && block.endsWith('```')) {
      const inner = block.slice(3, -3);
      const newline = inner.indexOf('\n');
      const code = newline === -1 ? inner : inner.slice(newline + 1);
      return (
        <pre
          key={bIdx}
          className="my-3 overflow-x-auto rounded-lg border border-zinc-800 bg-[#18181b] p-3.5 font-mono text-[12.5px] leading-relaxed text-zinc-100"
        >
          <code>{code.trimEnd()}</code>
        </pre>
      );
    }

    const lines = block.split('\n');
    const nodes: ReactNode[] = [];
    let listItems: string[] = [];

    const flushList = (keyBase: string) => {
      if (listItems.length === 0) return;
      nodes.push(
        <ul key={keyBase} className="my-2 list-disc space-y-1 pl-5 text-stone-800">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    };

    lines.forEach((rawLine, lIdx) => {
      const line = rawLine.trimEnd();
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        listItems.push(bullet[1]);
        return;
      }
      flushList(`ul-${bIdx}-${lIdx}`);

      if (!line.trim()) {
        return;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        nodes.push(
          <p key={`h-${bIdx}-${lIdx}`} className="mt-3 mb-1 font-semibold text-stone-950">
            {renderInline(heading[2])}
          </p>
        );
        return;
      }

      nodes.push(
        <p key={`p-${bIdx}-${lIdx}`} className="my-1.5 leading-relaxed text-stone-800">
          {renderInline(line)}
        </p>
      );
    });

    flushList(`ul-end-${bIdx}`);
    return <div key={bIdx}>{nodes}</div>;
  });
}

export default function MessageItem({ message }: MessageItemProps) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-[#18181b] px-4 py-2.5 text-[14.5px] leading-relaxed text-zinc-50 shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="py-2">
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-900 shadow-sm"
        >
          <span className="font-mono font-semibold text-red-800">
            {message.statusCode ? `HTTP ${message.statusCode}` : 'ERROR'}
          </span>
          <span className="mx-2 text-red-300">·</span>
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  const meta = message.metadata;
  const isCache = meta?.resolution_source === 'LLM_CACHE';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <article
      data-testid="assistant-message"
      className="group my-2.5 overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 text-[15px]">{renderMarkdown(message.content)}</div>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-transparent px-2 py-1 font-mono text-[11px] text-stone-400 opacity-0 transition hover:border-stone-200 hover:bg-stone-100 hover:text-stone-900 group-hover:opacity-100 focus:opacity-100"
          title="Copy response"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {meta && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-stone-200/80 bg-[#f8f7f3] px-5 py-2 font-mono text-[11px] tabular-nums text-stone-500">
          <span
            data-testid="meta-source"
            className={
              isCache
                ? 'font-semibold text-emerald-700'
                : 'font-semibold text-teal-800'
            }
          >
            {meta.resolution_source}
          </span>
          <span className="text-stone-300">·</span>
          <span data-testid="meta-model" className="text-stone-700">
            {meta.model}
          </span>
          <span className="text-stone-300">·</span>
          <span data-testid="meta-latency" className="text-stone-600">
            {meta.latency_ms} ms
          </span>
          <span className="text-stone-300">·</span>
          <span>
            in{' '}
            <span data-testid="meta-input-tokens" className="font-semibold text-stone-900">
              {meta.input_tokens}
            </span>
            {' / out '}
            <span data-testid="meta-output-tokens" className="font-semibold text-stone-900">
              {meta.output_tokens}
            </span>
          </span>
          <span className="text-stone-300">·</span>
          <span className="text-stone-600">{meta.key_id ?? 'cache'}</span>
          {meta.fallback_attempts > 0 && (
            <>
              <span className="text-stone-300">·</span>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">
                failover ×{meta.fallback_attempts}
              </span>
            </>
          )}
        </div>
      )}
    </article>
  );
}
