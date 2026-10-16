import { Bot, CornerDownLeft, Flame, Send } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, clientApi, type Sentiment } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatDay, formatTime } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { openTicket } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Avatar } from "./desk";
import { ErrorNote, Loading } from "./page";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { Tooltip } from "./ui/tooltip";

type Item =
  | {
      type: "message";
      id: string;
      groupId: string;
      ts: number;
      sender: string;
      text: string;
      hasMedia: boolean;
      sentiment?: Sentiment;
      smallTalk: boolean;
      evidence: Array<{ kind: string; issueId: string; title: string }>;
    }
  | { type: "bot"; id: string; ts: number; text: string }
  | { type: "activity"; id: string; ts: number; text: string; issueId?: string };

const EVIDENCE_LABEL: Record<string, string> = {
  reported: "Ticket",
  update: "Update on",
  confirmed_fixed: "Confirmed fixed",
  resolution: "Confirmed fixed",
};

interface FeedProps {
  clientId: string;
  /** Only show one WhatsApp group. */
  groupFilter?: string;
  /** Show only the last N items, without scrolling (for previews). */
  limit?: number;
  className?: string;
}

/**
 * One client's WhatsApp conversation: what's stored in its graph, then whatever arrives live.
 * Small talk is shown faded as it arrives but is never stored, so it disappears on reload.
 */
export function Feed(props: FeedProps) {
  return <FeedView key={props.clientId} {...props} />;
}

function FeedView({ clientId, groupFilter, limit, className }: FeedProps) {
  const user = useUser();
  const { events } = useLive();
  // Live events from before this view opened are already in the stored history.
  const [start] = useState(() => events.length);
  const stored = useLiveQuery(() => clientApi(clientId).feed(), [clientId]);
  // Ednovax staff write in every client's group; their messages sit on the right.
  const staff = useLiveQuery(api.staff);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = (stored.data ?? []).map((m) => ({
      type: "message",
      id: m.id,
      groupId: m.groupId,
      ts: m.ts,
      sender: m.senderName,
      text: m.text,
      hasMedia: m.hasMedia,
      sentiment: m.sentiment,
      smallTalk: false,
      evidence: m.evidence ?? [],
    }));
    const seen = new Set(list.map((item) => item.id));
    events.slice(start).forEach((event, index) => {
      if (event.clientId !== clientId) return;
      if (event.kind === "message") {
        const m = event.message;
        if (seen.has(m.id)) return;
        seen.add(m.id);
        list.push({ type: "message", id: m.id, groupId: m.groupId, ts: Date.parse(m.ts), sender: m.senderName, text: m.text, hasMedia: m.hasMedia, sentiment: m.sentiment, smallTalk: !m.relevant, evidence: [] });
      } else if (event.kind === "bot") {
        list.push({ type: "bot", id: `bot-${start + index}`, ts: Date.parse(event.ts), text: event.text });
      } else if (event.kind === "activity") {
        list.push({ type: "activity", id: `act-${start + index}`, ts: Date.parse(event.ts), text: event.text, issueId: event.issueId });
      }
    });
    const filtered = list.filter((item) => !groupFilter || item.type !== "message" || item.groupId === groupFilter).sort((a, b) => a.ts - b.ts);
    return limit ? filtered.slice(-limit) : filtered;
  }, [stored.data, events, start, clientId, groupFilter, limit]);

  // Follow new messages, unless the reader has scrolled up to read older ones.
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  if (stored.error) return <ErrorNote message={stored.error} />;
  if (!stored.data) return <Loading label="Loading the conversation" />;

  const isStaff = (name: string) => name === user.name || Boolean(staff.data?.some((member) => member.name === name));

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className={cn("bg-paper-2/60 px-4 py-4 sm:px-6", !limit && "h-[560px] overflow-y-auto", className)}
    >
      {items.length === 0 && <p className="py-16 text-center text-muted">No messages yet. When the client writes in their WhatsApp group, it appears here.</p>}
      {items.map((item, index) => {
        const previous = items[index - 1];
        const newDay = !previous || formatDay(previous.ts) !== formatDay(item.ts);
        return (
          <Fragment key={item.id}>
            {newDay && (
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="label">{formatDay(item.ts)}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {item.type === "activity" ? (
              <div className="my-2 text-center">
                {item.issueId ? (
                  <button onClick={() => openTicket(clientId, item.issueId!)} className="text-[12.5px] font-medium text-muted underline-offset-4 hover:text-primary hover:underline">
                    {item.text} · {formatTime(item.ts)}
                  </button>
                ) : (
                  <span className="text-[12.5px] font-medium text-muted">
                    {item.text} · {formatTime(item.ts)}
                  </span>
                )}
              </div>
            ) : item.type === "bot" ? (
              <div className="my-3 flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md border border-primary/20 bg-primary-soft px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                    <Bot className="size-3.5" /> Loopkeeper reminder · {formatTime(item.ts)}
                  </div>
                  <p className="text-[14px] whitespace-pre-wrap">{item.text}</p>
                </div>
              </div>
            ) : (
              <MessageBubble item={item} staff={isStaff(item.sender)} clientId={clientId} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function MessageBubble({ item, staff, clientId }: { item: Extract<Item, { type: "message" }>; staff: boolean; clientId: string }) {
  const mood = item.sentiment === "frustrated" || item.sentiment === "concerned" ? item.sentiment : undefined;
  return (
    <div className={cn("my-2.5 flex gap-2.5", staff ? "flex-row-reverse" : "flex-row", item.smallTalk && "opacity-55")}>
      {!staff && <Avatar name={item.sender} />}
      <div className={cn("flex max-w-[78%] flex-col", staff ? "items-end" : "items-start")}>
        <div className={cn("px-4 py-3", staff ? "rounded-2xl rounded-br-md bg-primary text-white shadow-[0_6px_16px_-8px_rgb(31_107_255/0.6)]" : "rounded-2xl rounded-bl-md border border-line-soft bg-card shadow-card")}>
          <div className={cn("mb-0.5 flex items-center gap-2 text-[12.5px] font-semibold", staff ? "text-white" : "text-ink")}>
            {item.sender}
            {mood && (
              <Tooltip content={`Sounds ${mood}`}>
                <Flame className={cn("size-3.5", mood === "frustrated" ? "text-red" : "text-amber")} />
              </Tooltip>
            )}
            <span className={cn("ml-auto pl-3 text-[11.5px] font-normal", staff ? "text-white/75" : "text-faint")}>{formatTime(item.ts)}</span>
          </div>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
            {item.hasMedia && <span className="mr-1">📷</span>}
            {item.text}
          </p>
        </div>
        {item.smallTalk && <span className="mt-1 text-[12.5px] font-medium text-faint">small talk, not stored</span>}
        {item.evidence.length > 0 && (
          <div className={cn("mt-1.5 flex flex-wrap gap-1.5", staff && "justify-end")}>
            {item.evidence.map((e) => (
              <button
                key={`${e.issueId}-${e.kind}`}
                onClick={() => openTicket(clientId, e.issueId)}
                className="max-w-[85%] truncate rounded-full border sm:max-w-80 border-line bg-card px-2.5 py-0.5 text-left text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
              >
                {EVIDENCE_LABEL[e.kind] ?? "Linked to"}: {e.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Write into the client's WhatsApp group as yourself. Counts as Ednovax's reply for the SLA. */
export function ReplyBox({ clientId, defaultText = "", onSent }: { clientId: string; defaultText?: string; onSent?: () => void }) {
  const user = useUser();
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  useEffect(() => setText(defaultText), [defaultText]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await clientApi(clientId).reply(text);
      setText("");
      setSent(true);
      onSent?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => (setText(e.target.value), setSent(false))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
        }}
        placeholder="Reply in the client's WhatsApp group…"
        className="min-h-20"
      />
      {error && <ErrorNote message={error} />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-muted">
          {sent ? "Sent. It counts as Ednovax's reply." : (
            <>
              Sends as {user.name} · <CornerDownLeft className="inline size-3" /> Ctrl+Enter
            </>
          )}
        </span>
        <Button onClick={send} disabled={busy || !text.trim()}>
          <Send /> Send to group
        </Button>
      </div>
    </div>
  );
}
