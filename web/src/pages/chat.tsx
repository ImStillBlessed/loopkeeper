import { ChevronDown, Image as ImageIcon, Radio, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/composer";
import { Page } from "@/components/page";
import { PeopleRail, PickedUpRail } from "@/components/rails";
import { Segmented } from "@/components/segmented";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FeedMessage, PipelineEvent } from "@/lib/api";
import { formatDay, formatTime, plural } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS, MESSAGE_KINDS } from "@/lib/palette";

type Item =
  | { kind: "day"; key: string; label: string }
  | { kind: "noise"; key: string; messages: FeedMessage[] }
  | { kind: "work"; key: string; message: FeedMessage; notes: Array<{ text: string; issueId?: string }> }
  | { kind: "bot"; key: string; text: string; ts: string };

/**
 * Turns the raw event stream into what a person wants to see for one group: work, with small talk
 * folded away, and what Loopkeeper did about each message.
 */
function toItems(events: PipelineEvent[], groupId: string | undefined): Item[] {
  const items: Item[] = [];
  let lastDay = "";
  let lastWork: Extract<Item, { kind: "work" }> | undefined;

  for (const [index, event] of events.entries()) {
    if (event.kind === "message" && groupId && event.message.groupId !== groupId) continue;
    if (event.kind === "message") {
      const day = formatDay(event.message.ts);
      if (day !== lastDay) {
        items.push({ kind: "day", key: `day-${day}`, label: day });
        lastDay = day;
      }
      if (event.message.relevant) {
        lastWork = { kind: "work", key: event.message.id, message: event.message, notes: [] };
        items.push(lastWork);
      } else {
        const previous = items.at(-1);
        if (previous?.kind === "noise") previous.messages.push(event.message);
        else items.push({ kind: "noise", key: `noise-${event.message.id}`, messages: [event.message] });
      }
    }
    if (event.kind === "activity" && lastWork) lastWork.notes.push({ text: event.text, issueId: event.issueId });
    if (event.kind === "bot" && (!event.groupId || !groupId || event.groupId === groupId)) {
      items.push({ kind: "bot", key: `bot-${index}`, text: event.text, ts: event.ts });
    }
  }
  return items;
}

export function ChatPage() {
  const live = useLive();
  const { go } = useNavigation();
  const { data: groups } = useLiveQuery((api) => api.groups());
  const [chosenGroupId, setChosenGroupId] = useState<string>();
  const groupId = chosenGroupId ?? live.liveGroupId ?? groups?.[0]?.id;
  const group = groups?.find((g) => g.id === groupId);
  const items = useMemo(() => toItems(live.events, groupId), [live.events, groupId]);
  const end = useRef<HTMLDivElement>(null);

  // Follow along while messages stream in.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  if (groups && groups.length === 0) {
    return (
      <Page>
        <h1 className="text-headline font-light tracking-tight">No WhatsApp group yet</h1>
        <p className="mt-4 text-lead text-muted">Add a group to this project, then go live or write into it.</p>
        <Button size="lg" className="mt-10" onClick={() => go("settings")}>
          Add a group
        </Button>
      </Page>
    );
  }

  return (
    <Page left={<PeopleRail />} right={<PickedUpRail />}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-headline font-light tracking-tight">{group?.name ?? "Chat"}</h1>
          <p className="mt-3 text-lead text-muted">The WhatsApp group, as Loopkeeper reads it. Small talk is folded away.</p>
        </div>
        {groups && groups.length > 1 && (
          <Segmented<string> value={groupId ?? ""} onChange={setChosenGroupId} options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-20 flex flex-col items-start gap-8">
          <p className="text-title font-light text-muted">The chat is quiet. Go live, or write something below.</p>
          {!live.live && (
            <Button size="lg" onClick={() => void live.goLive(groupId)}>
              <Radio /> Go live
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-14 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.key}
                layout="position"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                className={item.kind === "bot" ? "self-end" : undefined}
              >
                {item.kind === "day" && <DayDivider label={item.label} />}
                {item.kind === "noise" && <NoiseFold messages={item.messages} />}
                {item.kind === "work" && <WorkBubble item={item} />}
                {item.kind === "bot" && <BotBubble text={item.text} ts={item.ts} />}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      <div ref={end} />
      <Composer groupId={groupId} />
    </Page>
  );
}

function DayDivider({ label }: { label: string }) {
  return <h2 className="pt-10 pb-3 text-lead font-medium text-faint">{label}</h2>;
}

/** Consecutive small talk becomes one quiet pill. Open it to see what was set aside. */
function NoiseFold({ messages }: { messages: FeedMessage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-pill px-4 py-2 text-small text-faint transition-colors hover:bg-surface-1 hover:text-muted"
        aria-expanded={open}
      >
        {plural(messages.length, "message")} of small talk
        <ChevronDown className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            {messages.map((m) => (
              <li key={m.id} className="flex gap-3 px-4 py-1.5 text-small text-faint">
                <span className="shrink-0 tabular-nums">{formatTime(m.ts)}</span>
                <span className="shrink-0 text-muted">{m.senderName}</span>
                <span className="truncate">{m.text || "Sticker or photo"}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function WorkBubble({ item }: { item: Extract<Item, { kind: "work" }> }) {
  const { openIssue } = useNavigation();
  const kind = item.message.type ? MESSAGE_KINDS[item.message.type] : undefined;

  return (
    <div className="max-w-[90%]">
      <div className="rounded-card rounded-tl-md bg-surface-1 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-small font-medium text-sky">{item.message.senderName}</span>
          <span className="text-small text-faint tabular-nums">{formatTime(item.message.ts)}</span>
        </div>
        {item.message.hasMedia && (
          <p className="mt-2 flex items-center gap-2 text-muted">
            <ImageIcon className="size-4" /> Photo
          </p>
        )}
        {item.message.text && <p className="mt-2 text-lead text-pretty">{item.message.text}</p>}
        {kind && (
          <Badge color={kind.color} className="mt-4">
            {kind.label}
          </Badge>
        )}
      </div>
      {item.notes.map((note, index) => (
        <button
          key={index}
          disabled={!note.issueId}
          onClick={() => note.issueId && openIssue(note.issueId)}
          className="mt-2 ml-4 flex items-start gap-2 text-left text-small text-lilac/90 enabled:hover:text-lilac"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          {note.text}
        </button>
      ))}
    </div>
  );
}

function BotBubble({ text, ts }: { text: string; ts: string }) {
  return (
    <div className="max-w-md rounded-card rounded-tr-md px-6 py-5" style={{ backgroundColor: `color-mix(in srgb, ${COLORS.lilac} 18%, transparent)` }}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-small font-medium text-lilac">Loopkeeper</span>
        <span className="text-small text-faint tabular-nums">{formatTime(ts)}</span>
      </div>
      <p className="mt-2 text-lead text-pretty">{text}</p>
    </div>
  );
}
