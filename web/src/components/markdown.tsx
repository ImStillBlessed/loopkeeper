import type { ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { COLORS } from "@/lib/palette";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  text: string;
  /** Message ids cited in the answer → their number in the sources list. */
  citations?: Map<string, number>;
  onCite?: () => void;
  onOpenIssue?: (issueId: string) => void;
  className?: string;
}

/** Only the languages answers actually contain, so the dashboard stays small. */
const HIGHLIGHT = { languages: { bash, javascript, json, python, sql, typescript }, detect: false };

const CITE = "#cite-";
const ISSUE = "#issue-";

/**
 * Agent answers as rich Markdown: tables, lists, code with highlighting, quotes. Two things are
 * turned into chips first: message citations ([msg_…] → a numbered source) and issue ids
 * (iss_… → opens the issue).
 */
export function Markdown({ text, citations = new Map(), onCite, onOpenIssue, className }: MarkdownProps) {
  const prepared = text
    .replace(/\[(msg_[a-f0-9]+)\]/g, (_, id: string) => (citations.has(id) ? `[${citations.get(id)}](${CITE}${id})` : ""))
    .replace(/(?<![\w/#-])(iss_[a-f0-9]{16})\b/g, (id: string) => `[${id}](${ISSUE}${id})`);

  const components: Components = {
    a: ({ href = "", children }) => {
      if (href.startsWith(CITE)) {
        return (
          <button
            onClick={onCite}
            className="mx-0.5 inline-grid size-6 -translate-y-0.5 place-items-center rounded-full align-middle text-[12px] font-medium text-black"
            style={{ backgroundColor: COLORS.mint }}
            aria-label={`Source ${String(children)}`}
          >
            {children}
          </button>
        );
      }
      if (href.startsWith(ISSUE)) {
        return (
          <button
            onClick={() => onOpenIssue?.(href.slice(ISSUE.length))}
            className="rounded-chip bg-coral/12 px-2 py-0.5 font-mono text-[0.8em] text-coral transition-colors hover:bg-coral/20"
            title="Open this issue"
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="text-lilac underline decoration-lilac/40 underline-offset-4 hover:decoration-lilac">
          {children}
        </a>
      );
    },
    p: (props) => <p className="my-3 first:mt-0 last:mb-0" {...strip(props)} />,
    strong: (props) => <strong className="font-medium text-foreground" {...strip(props)} />,
    em: (props) => <em className="text-foreground/90 italic" {...strip(props)} />,
    h1: (props) => <h3 className="mt-6 mb-3 text-title font-medium first:mt-0" {...strip(props)} />,
    h2: (props) => <h3 className="mt-6 mb-3 text-title font-medium first:mt-0" {...strip(props)} />,
    h3: (props) => <h4 className="mt-5 mb-2 text-lead font-medium first:mt-0" {...strip(props)} />,
    h4: (props) => <h4 className="mt-5 mb-2 text-lead font-medium first:mt-0" {...strip(props)} />,
    ul: (props) => <ul className="my-3 flex list-disc flex-col gap-2 pl-6 marker:text-lilac" {...strip(props)} />,
    ol: (props) => <ol className="my-3 flex list-decimal flex-col gap-2 pl-6 marker:text-muted" {...strip(props)} />,
    li: (props) => <li className="pl-1" {...strip(props)} />,
    blockquote: (props) => <blockquote className="my-4 border-l-2 border-mint/60 pl-5 text-muted italic" {...strip(props)} />,
    hr: () => <hr className="my-6 border-hairline" />,
    code: ({ className: lang, children }) =>
      lang ? (
        <code className={cn(lang, "font-mono text-[13px] leading-relaxed")}>{children}</code>
      ) : (
        <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-sunflower">{children}</code>
      ),
    pre: (props) => <pre className="my-4 overflow-x-auto rounded-chip bg-black/50 p-5" {...strip(props)} />,
    table: (props) => (
      <div className="my-5 overflow-x-auto rounded-chip bg-surface-1">
        <table className="w-full border-collapse text-left text-body" {...strip(props)} />
      </div>
    ),
    thead: (props) => <thead className="text-small text-muted" {...strip(props)} />,
    th: (props) => <th className="border-b border-hairline px-4 py-3 font-medium whitespace-nowrap" {...strip(props)} />,
    td: (props) => <td className="border-b border-hairline px-4 py-3 align-top [tr:last-child_&]:border-b-0" {...strip(props)} />,
  };

  return (
    <div className={cn("markdown text-lead leading-relaxed text-pretty", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, HIGHLIGHT]]} components={components}>
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

/** react-markdown passes a `node` prop that shouldn't reach the DOM. */
function strip<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const { node: _node, ...rest } = props;
  return rest;
}

export type MarkdownComponentProps = ComponentProps<typeof Markdown>;
