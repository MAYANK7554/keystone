import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownContentProps {
  content: string;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#070709]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-300">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded-md border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[12.5px] text-indigo-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className="italic text-zinc-200">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderTextBlock(block: string, blockKey: number): React.ReactNode {
  const lines = block.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;

  const flushList = (keySuffix: number) => {
    if (!listItems) return;
    if (listItems.ordered) {
      elements.push(
        <ol
          key={`ol-${blockKey}-${keySuffix}`}
          className="my-2 ml-5 list-decimal space-y-1 text-zinc-200 marker:text-zinc-500"
        >
          {listItems.items.map((item, idx) => (
            <li key={idx} className="pl-1">
              {renderInline(item)}
            </li>
          ))}
        </ol>,
      );
    } else {
      elements.push(
        <ul
          key={`ul-${blockKey}-${keySuffix}`}
          className="my-2 ml-4 list-disc space-y-1 text-zinc-200 marker:text-zinc-500"
        >
          {listItems.items.map((item, idx) => (
            <li key={idx} className="pl-1">
              {renderInline(item)}
            </li>
          ))}
        </ul>,
      );
    }
    listItems = null;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);

    if (bulletMatch) {
      if (listItems && listItems.ordered) flushList(idx);
      if (!listItems) listItems = { ordered: false, items: [] };
      listItems.items.push(bulletMatch[1]);
      return;
    }

    if (orderedMatch) {
      if (listItems && !listItems.ordered) flushList(idx);
      if (!listItems) listItems = { ordered: true, items: [] };
      listItems.items.push(orderedMatch[1]);
      return;
    }

    flushList(idx);

    if (!trimmed) {
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      elements.push(
        <p key={`h-${blockKey}-${idx}`} className="mt-3 mb-1 font-semibold text-white">
          {renderInline(headingMatch[2])}
        </p>,
      );
      return;
    }

    elements.push(
      <p key={`p-${blockKey}-${idx}`} className="mb-2 last:mb-0 leading-relaxed text-zinc-100">
        {renderInline(line)}
      </p>,
    );
  });

  flushList(lines.length);
  return <React.Fragment key={blockKey}>{elements}</React.Fragment>;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const segments = content.split(/(```[\w-]*\n[\s\S]*?```)/g);

  return (
    <div className="text-[14.5px] leading-relaxed break-words">
      {segments.map((segment, index) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3);
          const newlineIdx = inner.indexOf('\n');
          const language = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : '';
          const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
          return <CodeBlock key={index} language={language} code={code.replace(/\n$/, '')} />;
        }
        return renderTextBlock(segment, index);
      })}
    </div>
  );
};
