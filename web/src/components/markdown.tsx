import ReactMarkdown, { type Components } from "react-markdown";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  text: string;
  /** Message ids cited in the answer → their number in the sources list. */
  citations?: Map<string, number>;
  onCite?: () => void;
  /** Opens a ticket. Without it, ticket ids are shown as plain mono text. */
  onOpenIssue?: (issueId: string) => void;
  className?: string;
}

/** Only the languages answers actually contain, so the dashboard stays small. */
const HIGHLIGHT = { languages: { bash, javascript, json, python, sql, typescript }, detect: false };

const CITE = "#cite-";
const ISSUE = "#issue-";

/**
 * Agent answers as Markdown: tables, lists, code, quotes. Two things become chips first:
 * message citations ([msg_…] → a numbered source) and ticket ids (iss_… → opens the ticket).
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
            className="mx-0.5 inline-grid h-4.5 min-w-4.5 -translate-y-0.5 place-items-center bg-primary px-1 align-middle font-mono text-[10.5px] font-semibold text-primary-ink"
            aria-label={`Source ${String(children)}`}
          >
            {children}
          </button>
        );
      }
      if (href.startsWith(ISSUE)) {
        const id = href.slice(ISSUE.length);
        if (!onOpenIssue) return <code className="bg-paper-2 px-1 font-mono text-[0.82em] text-ink-2">{children}</code>;
        return (
          <button onClick={() => onOpenIssue(id)} className="bg-primary-soft px-1.5 py-0.5 font-mono text-[0.8em] text-primary transition-colors hover:bg-primary hover:text-primary-ink" title="Open this ticket">
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
          {children}
        </a>
      );
    },
    p: (props) => <p className="my-3 first:mt-0 last:mb-0" {...strip(props)} />,
    strong: (props) => <strong className="font-semibold text-ink" {...strip(props)} />,
    em: (props) => <em className="italic" {...strip(props)} />,
    h1: (props) => <h3 className="mt-6 mb-2 text-[20px] first:mt-0" {...strip(props)} />,
    h2: (props) => <h3 className="mt-6 mb-2 text-[20px] first:mt-0" {...strip(props)} />,
    h3: (props) => <h4 className="mt-5 mb-2 text-[17px] first:mt-0" {...strip(props)} />,
    h4: (props) => <h4 className="mt-5 mb-2 text-[17px] first:mt-0" {...strip(props)} />,
    ul: (props) => <ul className="my-3 flex list-[square] flex-col gap-1.5 pl-5 marker:text-flourish" {...strip(props)} />,
    ol: (props) => <ol className="my-3 flex list-decimal flex-col gap-1.5 pl-5 marker:font-mono marker:text-muted" {...strip(props)} />,
    li: (props) => <li className="pl-1" {...strip(props)} />,
    blockquote: (props) => <blockquote className="my-4 border-l-2 border-primary pl-4 text-muted" {...strip(props)} />,
    hr: () => <hr className="my-6 border-line" />,
    code: ({ className: lang, children }) =>
      lang ? (
        <code className={cn(lang, "font-mono text-[12.5px] leading-relaxed")}>{children}</code>
      ) : (
        <code className="bg-paper-2 px-1 py-0.5 font-mono text-[0.85em] text-ink-2">{children}</code>
      ),
    pre: (props) => <pre className="my-4 overflow-x-auto rounded-xl border border-line-soft bg-paper p-4" {...strip(props)} />,
    table: (props) => (
      <div className="my-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-[14px]" {...strip(props)} />
      </div>
    ),
    thead: (props) => <thead className="bg-paper-2" {...strip(props)} />,
    th: (props) => <th className="border-b border-line bg-paper px-3 py-2.5 text-[12.5px] font-semibold whitespace-nowrap text-muted" {...strip(props)} />,
    td: (props) => <td className="border-b border-line-soft px-3 py-2 align-top [tr:last-child_&]:border-b-0" {...strip(props)} />,
  };

  return (
    <div className={cn("text-[15.5px] leading-relaxed text-pretty text-ink", className)}>
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
