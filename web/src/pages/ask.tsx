import { ArrowUp, ChevronDown, Globe2, MessageSquarePlus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Headline, Page, RailSection } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import type { Answer, ConversationSummary, Turn } from "@/lib/api";
import { formatShortDay, formatTime, plural } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS } from "@/lib/palette";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's still open, and who are we waiting on?",
  "Which promises are overdue?",
  "Who should fix the biggest open problem, and which files are involved?",
];

const EASE = [0.32, 0.72, 0, 1] as const;

/** What the agent can look up, in plain words. Each one is a Cypher query on the graph. */
const ABILITIES = [
  "What's open or resolved, for any school, person or feature",
  "The full story of one issue, from chat to code",
  "Promises that are due or overdue",
  "Who knows a part of the product best",
  "Which schools a problem affects",
  "Which issues matter most right now",
  "How two people or things are connected",
  "Decisions the group has made",
  "Pull requests and commits for an issue",
];

/** A turn waiting for its answer, or one whose answer failed. */
interface PendingTurn {
  question: string;
  askedAt: number;
  error?: string;
}

/**
 * Ask as conversations. Follow-ups continue the open conversation, and the agent sees what was said
 * before. Each conversation is one node in the project's graph, so it is all still here after a refresh.
 */
export function AskPage() {
  const { api } = useLive();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<PendingTurn>();
  const [loaded, setLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const thinking = Boolean(pending && !pending.error);

  const open = useCallback(
    async (id: string | undefined) => {
      setCurrentId(id);
      setPending(undefined);
      setTurns(id ? (await api.conversation(id)).turns : []);
    },
    [api],
  );

  const refreshList = useCallback(async () => {
    const list = await api.conversations();
    setConversations(list);
    return list;
  }, [api]);

  // Open the most recent conversation on arrival.
  useEffect(() => {
    refreshList()
      .then((list) => open(list[0]?.id))
      .finally(() => setLoaded(true));
  }, [refreshList, open]);

  // Keep the newest turn in view.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, pending]);

  const ask = async (text: string) => {
    if (!text.trim() || thinking) return;
    setQuestion("");
    setPending({ question: text, askedAt: Date.now() });
    try {
      const result = await api.ask(text, currentId);
      setCurrentId(result.conversationId);
      setTurns((all) => [...all, result.turn]);
      setPending(undefined);
      void refreshList();
    } catch (e) {
      setPending({ question: text, askedAt: Date.now(), error: (e as Error).message });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const empty = loaded && turns.length === 0 && !pending;

  return (
    <Page
      left={
        <RailSection title="What I can look up">
          <ul className="flex flex-col gap-3 text-small text-muted">
            {ABILITIES.map((a) => (
              <li key={a} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-lilac" />
                {a}
              </li>
            ))}
          </ul>
        </RailSection>
      }
      right={
        <RailSection title="Conversations">
          <Button variant="secondary" size="sm" className="mb-5 w-full" onClick={() => void open(undefined)} disabled={!currentId && turns.length === 0}>
            <MessageSquarePlus /> New conversation
          </Button>
          {conversations.length === 0 ? (
            <p className="text-small text-faint">Conversations are remembered here.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {conversations.map((conversation) => (
                <li key={conversation.id} className="group relative">
                  <button
                    onClick={() => void open(conversation.id)}
                    className={cn(
                      "w-full rounded-chip px-3 py-2.5 pr-10 text-left transition-colors",
                      conversation.id === currentId ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-1 hover:text-foreground",
                    )}
                  >
                    <span className="line-clamp-2 text-small">{conversation.title}</span>
                    <span className="mt-0.5 block text-small text-faint">
                      {formatShortDay(conversation.updatedAt)}, {plural(conversation.turnCount, "question")}
                    </span>
                  </button>
                  <Confirm
                    title="Delete this conversation?"
                    description={`"${conversation.title}" and its answers will be forgotten.`}
                    action="Delete"
                    onConfirm={async () => {
                      await api.deleteConversation(conversation.id);
                      const list = await refreshList();
                      if (conversation.id === currentId) await open(list[0]?.id);
                    }}
                  >
                    <button
                      className="absolute top-2.5 right-2 grid size-7 place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-coral focus-visible:opacity-100"
                      aria-label={`Delete "${conversation.title}"`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Confirm>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      }
    >
      {empty && (
        <>
          <Headline>Ask about any school, problem or promise.</Headline>
          <div className="mt-12 flex flex-col items-start gap-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void ask(s)} className="rounded-pill px-5 py-2.5 text-left text-body text-muted transition-colors hover:bg-surface-1 hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-col gap-16">
        {turns.map((turn) => (
          <motion.section key={turn.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
            <QuestionBubble text={turn.question} at={turn.askedAt} />
            <AnswerView answer={turn.answer} />
          </motion.section>
        ))}
        {pending && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
            <QuestionBubble text={pending.question} at={pending.askedAt} />
            {pending.error ? (
              <p className="mt-6 text-lead text-coral">Couldn't answer that: {pending.error}</p>
            ) : (
              <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }} className="mt-6 text-title font-light text-muted">
                Following the threads…
              </motion.p>
            )}
          </motion.section>
        )}
      </div>
      <div ref={end} />

      <form onSubmit={submit} className="sticky bottom-28 z-10 mt-12">
        <div className="flex items-center gap-2 rounded-pill bg-[#1b1b21]/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={turns.length ? "Ask a follow-up…" : "What's still open, and who are we waiting on?"}
            aria-label="Your question"
            className="h-12 min-w-0 flex-1 bg-transparent px-5 text-lead text-foreground placeholder:text-faint outline-none"
          />
          <Button type="submit" size="icon" disabled={!question.trim() || thinking} aria-label="Ask">
            <ArrowUp />
          </Button>
        </div>
      </form>
    </Page>
  );
}

function QuestionBubble({ text, at }: { text: string; at: number }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-card rounded-tr-md px-6 py-4" style={{ backgroundColor: `color-mix(in srgb, ${COLORS.lilac} 16%, transparent)` }}>
        <p className="text-lead text-pretty">{text}</p>
        <p className="mt-1 text-right text-small text-faint">
          {formatShortDay(at)}, {formatTime(at)}
        </p>
      </div>
    </div>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const { showOnGlobe, openIssue } = useNavigation();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const numbers = new Map(answer.sources.map((s, i) => [s.messageId, i + 1]));

  return (
    <motion.article initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: EASE }} className="mt-6">
      <Markdown text={answer.answer} citations={numbers} onCite={() => setSourcesOpen(true)} onOpenIssue={openIssue} />

      <div className="mt-12 flex flex-wrap gap-3">
        {answer.sources.length > 0 && (
          <Button variant="secondary" onClick={() => setSourcesOpen(!sourcesOpen)} aria-expanded={sourcesOpen}>
            Based on {plural(answer.sources.length, "message")}
            <ChevronDown className={`transition-transform duration-300 ${sourcesOpen ? "rotate-180" : ""}`} />
          </Button>
        )}
        {answer.graphPath.nodeIds.length > 0 && (
          <Button variant="secondary" onClick={() => showOnGlobe(answer.graphPath.nodeIds)}>
            <Globe2 /> See the path on the globe
          </Button>
        )}
        <Button variant="ghost" onClick={() => setHowOpen(!howOpen)} aria-expanded={howOpen}>
          How I found this
        </Button>
      </div>

      <Reveal open={sourcesOpen}>
        <ol className="mt-8 flex flex-col gap-3">
          {answer.sources.map((s, i) => (
            <li key={s.messageId} className="flex gap-4 rounded-card bg-surface-1 px-6 py-5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full text-small font-medium text-black" style={{ backgroundColor: COLORS.mint }}>
                {i + 1}
              </span>
              <div>
                <p className="text-small text-muted">
                  <span className="font-medium text-sky">{s.sender}</span>, {s.ts}
                </p>
                <p className="mt-1 text-body text-pretty">“{s.excerpt}”</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal open={howOpen}>
        <div className="mt-8 rounded-card bg-surface-1 p-7">
          <p className="text-body text-muted">
            I answered by querying the FalkorDB graph{answer.toolCalls.length ? `, using ${answer.toolCalls.map((c) => c.tool.replaceAll("_", " ")).join(", then ")}` : ""}.
          </p>
          {answer.queriesRun.map((q) => (
            <div key={q.id} className="mt-6">
              <p className="text-small font-medium">{q.title}</p>
              <pre className="mt-2 overflow-x-auto rounded-chip bg-black/60 p-4 text-[13px] leading-relaxed text-muted">{q.cypher}</pre>
            </div>
          ))}
        </div>
      </Reveal>
    </motion.article>
  );
}

function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} className="overflow-hidden">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
