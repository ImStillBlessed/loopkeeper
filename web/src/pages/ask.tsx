import { BookPlus, ChevronRight, History, MessageCircleQuestion, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/desk";
import { Markdown } from "@/components/markdown";
import { Empty, ErrorNote, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { api, clientApi, type Answer, type ClientSummary, type SharedConversation, type Turn } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { ago, formatDateTime } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { href, navigate, openTicket } from "@/lib/router";
import { cn } from "@/lib/utils";

const STARTERS = {
  hq: ["Which clients need attention today?", "Which SLA breaches do we have and who owns them?", "What problems are several schools reporting?", "Who has the most open tickets?"],
  client: ["What is still open and who are we waiting on?", "What did we promise this client?", "Summarise the last week", "Is anyone else seeing the same problem?"],
};

/** A turn being shown: a saved one, or a question still waiting for its answer. */
interface Shown {
  question: string;
  askedBy?: string;
  askedAt?: number;
  kind: "question" | "note";
  answer?: Answer;
}

/**
 * Ask, shared by the whole team. Every conversation is kept and visible to anyone who can see the
 * clients it's about, so people can read and carry on each other's. When someone tells the AI something
 * new (a problem, a promise, a decision, a fact), it stores it in the client's graph by itself.
 */
export function AskPage({ scope, conversationId }: { scope: string; conversationId?: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: clients } = useLiveQuery(api.clients);
  const { data: conversations, reload } = useLiveQuery(api.conversations);
  const current = conversations?.find((c) => c.id === conversationId);

  const open = (c: SharedConversation) => {
    setHistoryOpen(false);
    navigate(href("ask", { scope: c.scope, c: c.id }));
  };
  const startNew = () => navigate(href("ask", { scope }));

  const history = <ConversationList conversations={conversations} activeId={conversationId} onOpen={open} onDeleted={(id) => (id === conversationId ? startNew() : reload())} />;

  return (
    <Page>
      <PageHeader
        title="Ask"
        lead="Shared with the team. Tell it something new and it remembers."
        actions={
          <>
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
              <History /> History {conversations ? `(${conversations.length})` : ""}
            </Button>
            <Button size="sm" onClick={startNew}>
              <Plus /> New conversation
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Conversations" className="hidden h-fit lg:flex" summary={conversations?.length}>
          {history}
        </Panel>

        <Conversation
          key={`${scope}:${conversationId ?? "new"}`}
          scope={scope}
          conversationId={conversationId}
          clients={clients ?? []}
          meta={current}
          onSaved={(id) => {
            reload();
            if (id !== conversationId) navigate(href("ask", { scope, c: id }));
          }}
        />
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent title="Conversations" width="md">
          {history}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

// ─── The shared list ─────────────────────────────────────────────────────────

function ConversationList({
  conversations,
  activeId,
  onOpen,
  onDeleted,
}: {
  conversations: SharedConversation[] | undefined;
  activeId?: string;
  onOpen: (c: SharedConversation) => void;
  onDeleted: (id: string) => void;
}) {
  const user = useUser();
  const { clock } = useLive();
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (conversations ?? []).filter(
      (c) => (filter === "all" || c.createdBy === user.name || c.lastBy === user.name) && (!needle || `${c.title} ${c.scopeName} ${c.createdBy}`.toLowerCase().includes(needle)),
    );
  }, [conversations, filter, search, user.name]);

  const mayDelete = (c: SharedConversation) => !c.createdBy || c.createdBy === user.name || user.role === "admin" || user.role === "lead";

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 border-b border-line-soft px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" className="h-9 pl-8 text-[13.5px]" aria-label="Search conversations" />
        </div>
        <Segmented
          label="Whose conversations"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "Everyone's" },
            { id: "mine", label: "Mine" },
          ]}
        />
      </div>
      {!conversations ? (
        <p className="px-4 py-5 text-[13.5px] text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-5 text-[13.5px] text-muted">{conversations.length ? "Nothing matches." : "No conversations yet. Questions you ask are kept here for the whole team."}</p>
      ) : (
        <ul className="max-h-[65vh] overflow-y-auto">
          {shown.map((c) => (
            <li key={`${c.scope}:${c.id}`} className={cn("group flex items-start border-b border-line-soft last:border-b-0", c.id === activeId && "bg-primary-soft/60")}>
              <button onClick={() => onOpen(c)} className="min-w-0 flex-1 px-4 py-3 text-left">
                <div className={cn("line-clamp-2 text-[14px]", c.id === activeId ? "font-semibold text-primary" : "font-medium")}>{c.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                  <span className={cn("rounded-full px-1.5 py-px font-semibold", c.scope === "hq" ? "bg-violet-soft text-violet" : "bg-sky-soft text-sky")}>{c.scopeName}</span>
                  <span className="truncate">
                    {c.createdBy || "Someone"} · {c.turnCount} · {ago(c.updatedAt, clock)}
                  </span>
                </div>
              </button>
              {mayDelete(c) && (
                <Confirm
                  title="Delete this conversation?"
                  description="It's removed for everyone. Anything added to the graph from it stays."
                  action="Delete"
                  onConfirm={async () => {
                    await (c.scope === "hq" ? api.deleteHqConversation(c.id) : clientApi(c.scope).deleteConversation(c.id));
                    onDeleted(c.id);
                  }}
                >
                  <button className="mt-3 mr-2 grid size-7 place-items-center rounded-lg text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-red focus:opacity-100 max-lg:opacity-100" aria-label="Delete conversation">
                    <Trash2 className="size-3.5" />
                  </button>
                </Confirm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── One conversation ────────────────────────────────────────────────────────

function Conversation({
  scope,
  conversationId,
  clients,
  meta,
  onSaved,
}: {
  scope: string;
  conversationId?: string;
  clients: ClientSummary[];
  meta?: SharedConversation;
  onSaved: (id: string) => void;
}) {
  const { version } = useLive();
  const isHq = scope === "hq";
  const [turns, setTurns] = useState<Shown[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Ticket ids are per client, so answers across clients open a ticket by looking up whose it is.
  const [owners, setOwners] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (isHq) api.tickets().then((tickets) => setOwners(new Map(tickets.map((t) => [t.id, t.clientId]))), () => undefined);
  }, [isHq]);

  // Load the conversation, and reload it when the desk changes, so teammates' turns appear.
  useEffect(() => {
    if (!conversationId || busy) return;
    const load = isHq ? api.hqConversation(conversationId) : clientApi(scope).conversation(conversationId);
    load.then((c) => setTurns(c.turns.map(toShown)), (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, scope, version]);

  const send = async (text: string) => {
    setBusy(true);
    setError(undefined);
    setTurns((all) => [...all, { question: text, kind: "question" }]);
    try {
      const result = isHq ? await api.askHq(text, conversationId) : await clientApi(scope).ask(text, conversationId);
      setTurns((all) => [...all.slice(0, -1), toShown(result.turn)]);
      onSaved(result.conversationId);
    } catch (e) {
      setError((e as Error).message);
      setTurns((all) => all.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  const scopeOptions = [{ value: "hq", label: "All my clients" }, ...clients.map((c) => ({ value: c.id, label: c.name }))];
  const scopeName = isHq ? "All my clients" : (clients.find((c) => c.id === scope)?.name ?? "this client");

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {conversationId ? (
          <div className="flex min-w-0 items-center gap-2 text-[13.5px] text-muted">
            <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", isHq ? "bg-violet-soft text-violet" : "bg-sky-soft text-sky")}>{scopeName}</span>
            {meta?.createdBy && <span className="truncate">Started by {meta.createdBy}</span>}
          </div>
        ) : (
          <>
            <span className="text-[13.5px] font-semibold text-muted">About</span>
            <Select label="What this conversation is about" value={scope} onValueChange={(value) => navigate(href("ask", { scope: value }))} options={scopeOptions} className="min-w-56" />
          </>
        )}
      </div>

      <Thread turns={turns} busy={busy} onOpenIssue={(id) => (isHq ? owners.has(id) && openTicket(owners.get(id)!, id) : openTicket(scope, id))} />
      {turns.length === 0 && !conversationId && <Starters questions={isHq ? STARTERS.hq : STARTERS.client} onPick={send} disabled={busy} />}
      {error && <AskError message={error} />}
      <Composer onSend={send} busy={busy} />
    </div>
  );
}

function toShown(turn: Turn): Shown {
  return { question: turn.question, askedBy: turn.askedBy, askedAt: turn.askedAt, kind: turn.kind ?? "question", answer: turn.answer };
}

function Thread({ turns, busy, onOpenIssue }: { turns: Shown[]; busy: boolean; onOpenIssue?: (issueId: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: scrollIntoView returns a Promise in newer browsers, and an effect may only return a cleanup.
    void end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);
  if (turns.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn, index) =>
        turn.kind === "note" ? (
          <article key={index} className="rounded-2xl border border-green/20 bg-green-soft px-5 py-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-green">
              <BookPlus className="size-4" /> Added to the graph
              {turn.askedBy && <span className="font-normal text-muted">by {turn.askedBy}</span>}
              {turn.askedAt && <span className="ml-auto font-normal text-faint">{formatDateTime(turn.askedAt)}</span>}
            </div>
            <p className="mt-1.5 text-ink">{turn.question}</p>
            {turn.answer ? <p className="mt-1.5 text-[13px] text-muted">{turn.answer.answer}</p> : <p className="mt-1.5 text-[13px] text-muted">Adding…</p>}
          </article>
        ) : (
          <article key={index} className="card">
            <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
              {turn.askedBy ? <Avatar name={turn.askedBy} staff /> : <MessageCircleQuestion className="mt-1 size-5 text-primary" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted">
                  <span className="font-semibold text-ink-2">{turn.askedBy ?? "Question"}</span>
                  {turn.askedAt && <span>{formatDateTime(turn.askedAt)}</span>}
                </div>
                <p className="mt-0.5 font-display text-[17px] font-semibold tracking-tight">{turn.question}</p>
              </div>
            </div>
            <div className="px-5 py-4">{turn.answer ? <AnswerView answer={turn.answer} onOpenIssue={onOpenIssue} /> : <Reading />}</div>
          </article>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    onSend(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div className="card sticky bottom-4 flex items-end gap-3 p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask, or tell it something new… (Enter to send)"
        className="min-h-12 flex-1 border-0 px-2 focus:border-0 focus:shadow-none"
        rows={2}
        aria-label="Your message"
      />
      <Button onClick={submit} disabled={busy || !text.trim()}>
        Send
      </Button>
    </div>
  );
}

// ─── Answers, starters and errors ────────────────────────────────────────────

function Reading() {
  return (
    <div className="flex items-center gap-3 text-muted">
      <span className="size-2 animate-[pulse-dot_1s_ease-in-out_infinite] rounded-full bg-primary" />
      <span className="text-[14px]">Reading the graph…</span>
    </div>
  );
}

function AnswerView({ answer, onOpenIssue }: { answer: Answer | { answer: string }; onOpenIssue?: (issueId: string) => void }) {
  const full = "sources" in answer ? answer : undefined;
  const sourcesRef = useRef<HTMLDivElement>(null);
  const citations = new Map((full?.sources ?? []).map((s, i) => [s.messageId, i + 1]));

  return (
    <div>
      <Markdown text={answer.answer} citations={citations} onCite={() => sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })} onOpenIssue={onOpenIssue} />

      {"remembered" in answer && answer.remembered && answer.remembered.length > 0 && (
        <div className="mt-4 rounded-xl border border-green/20 bg-green-soft px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-green">
            <BookPlus className="size-4" /> Saved to the graph
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[14px] text-ink">
            {answer.remembered.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {full && full.sources.length > 0 && (
        <div ref={sourcesRef} className="mt-5 border-t border-line-soft pt-4">
          <div className="label mb-2">Sources</div>
          <ol className="flex flex-col gap-2">
            {full.sources.map((source, i) => (
              <li key={source.messageId} className="flex gap-3 text-[13.5px]">
                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1 text-[11.5px] font-semibold text-primary-ink">{i + 1}</span>
                <div className="min-w-0">
                  <span className="font-medium">{source.sender}</span>
                  <span className="ml-2 text-[12.5px] font-medium text-faint">{formatDateTime(source.ts)}</span>
                  <p className="text-muted">“{source.excerpt}”</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {full && (full.toolCalls.length > 0 || full.queriesRun.length > 0) && (
        <details className="group mt-4 border-t border-line-soft pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> How this was answered
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {full.toolCalls.length > 0 && (
              <div>
                <div className="label mb-1.5">Steps</div>
                <ol className="flex flex-col gap-1 font-mono text-[12px] text-ink-2">
                  {full.toolCalls.map((call, i) => (
                    <li key={i}>
                      {i + 1}. {call.tool}
                      <span className="text-faint"> {JSON.stringify(call.args)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {full.queriesRun.length > 0 && (
              <div>
                <div className="label mb-1.5">Graph queries</div>
                <div className="flex flex-col gap-3">
                  {full.queriesRun.map((q, i) => (
                    <div key={`${q.id}-${i}`}>
                      <div className="text-[13px]">
                        <span className="font-mono text-primary">{q.id}</span> {q.title}
                      </div>
                      <pre className="mt-1 overflow-x-auto rounded-xl border border-line-soft bg-paper p-3 font-mono text-[12.5px] leading-relaxed text-ink-2">{q.cypher.trim()}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Starters({ questions, onPick, disabled }: { questions: string[]; onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="card">
      <Empty title="Start a conversation">Pick a question, or write your own below. Everyone on the team can see and continue it.</Empty>
      <div className="grid border-t border-line-soft sm:grid-cols-2">
        {questions.map((q) => (
          <button
            key={q}
            disabled={disabled}
            onClick={() => onPick(q)}
            className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5 text-left text-[14.5px] transition-colors hover:bg-paper-2 hover:text-primary disabled:opacity-50 sm:odd:border-r"
          >
            {q}
            <ChevronRight className="size-4 shrink-0 text-faint" />
          </button>
        ))}
      </div>
    </div>
  );
}

function AskError({ message }: { message: string }) {
  const noKey = /api key|anthropic/i.test(message);
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={message} />
      {noKey && (
        <p className="text-[13.5px] text-muted">
          Answers need a language model key.{" "}
          <a href={href("settings", { section: "connections" })} className="text-primary underline underline-offset-4">
            Add one in Settings
          </a>
          .
        </p>
      )}
    </div>
  );
}

