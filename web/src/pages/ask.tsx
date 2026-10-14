import { ArrowUp, ChevronDown, Globe2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Headline, Page, RailSection } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type Answer } from "@/lib/api";
import { plural } from "@/lib/format";
import { useNavigation } from "@/lib/navigation";
import { COLORS } from "@/lib/palette";

const SUGGESTIONS = [
  "What's still open for Royal Academy, and who are we waiting on?",
  "Which promises are overdue?",
  "Who should fix the score saving problem?",
];

const EASE = [0.32, 0.72, 0, 1] as const;

/** What the agent can look up, in plain words. Each one is a Cypher query on the graph. */
const ABILITIES = [
  "What's open, for any school, person or feature",
  "The full story of one issue, from chat to code",
  "Promises that are due or overdue",
  "Who knows a part of the product best",
  "Which schools a problem affects",
  "Which issues matter most right now",
  "How two people or things are connected",
  "Decisions the group has made",
];

export function AskPage() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string>();
  const [answer, setAnswer] = useState<Answer>();
  const [error, setError] = useState<string>();
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const ask = async (text: string) => {
    if (!text.trim() || thinking) return;
    setQuestion(text);
    setAsked(text);
    setAnswer(undefined);
    setError(undefined);
    setThinking(true);
    setHistory((h) => [text, ...h.filter((q) => q !== text)].slice(0, 6));
    try {
      setAnswer(await api.ask(text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

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
        <RailSection title="Your recent questions">
          {history.length === 0 ? (
            <p className="text-small text-faint">Questions you ask will appear here.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((q) => (
                <li key={q}>
                  <button onClick={() => void ask(q)} className="text-left text-small text-muted transition-colors hover:text-foreground">{q}</button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      }
    >
      <Headline>Ask about any school, problem or promise.</Headline>

      <form onSubmit={submit} className="relative mt-14">
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What's still open for Royal Academy?" aria-label="Your question" className="pr-20" />
        <Button type="submit" size="icon" disabled={!question.trim() || thinking} className="absolute top-1.5 right-1.5" aria-label="Ask">
          <ArrowUp />
        </Button>
      </form>

      {!asked && (
        <div className="mt-6 flex flex-col items-start gap-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => void ask(s)} className="rounded-pill px-5 py-2.5 text-left text-body text-muted transition-colors hover:bg-surface-1 hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {thinking && (
          <motion.p key="thinking" initial={{ opacity: 0 }} animate={{ opacity: [0.4, 1, 0.4] }} exit={{ opacity: 0 }} transition={{ duration: 1.6, repeat: Infinity }} className="mt-16 text-title font-light text-muted">
            Following the threads…
          </motion.p>
        )}
        {error && (
          <motion.p key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-16 text-lead text-coral">
            Couldn't answer that: {error}
          </motion.p>
        )}
        {answer && <AnswerView key={asked} answer={answer} />}
      </AnimatePresence>
    </Page>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const { showOnGlobe } = useNavigation();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const numbers = new Map(answer.sources.map((s, i) => [s.messageId, i + 1]));

  return (
    <motion.article initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: EASE }} className="mt-16">
      <div className="flex flex-col gap-5 text-title font-light leading-snug text-pretty">{renderAnswer(answer.answer, numbers, () => setSourcesOpen(true))}</div>

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

/** Paragraphs and bullet lists, with **bold** and clickable citation numbers. */
function renderAnswer(text: string, numbers: Map<string, number>, onCite: () => void): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`list-${blocks.length}`} className="flex list-disc flex-col gap-3 pl-7 marker:text-lilac">
          {list.map((item, i) => <li key={i}>{inline(item, numbers, onCite)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{inline(line, numbers, onCite)}</p>);
  }
  flush();
  return blocks;
}

function inline(text: string, numbers: Map<string, number>, onCite: () => void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[msg_[a-f0-9]+\])/g).map((part, i) => {
    const bold = /^\*\*(.+)\*\*$/.exec(part);
    if (bold) return <strong key={i} className="font-medium">{bold[1]}</strong>;
    const cite = /^\[(msg_[a-f0-9]+)\]$/.exec(part);
    if (cite) {
      const n = numbers.get(cite[1]);
      return n ? (
        <button key={i} onClick={onCite} className="mx-0.5 inline-grid size-6 -translate-y-1 place-items-center rounded-full align-middle text-[12px] font-medium text-black" style={{ backgroundColor: COLORS.mint }}>
          {n}
        </button>
      ) : null;
    }
    return part;
  });
}
