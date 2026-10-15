import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, BookOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PreparedKind } from "@/lib/api";
import { useLive, useLiveQuery } from "@/lib/live";
import { COLORS } from "@/lib/palette";

const QUICK: Array<{ kind: PreparedKind; label: string; color: string }> = [
  { kind: "issue", label: "A problem", color: COLORS.coral },
  { kind: "question", label: "A question", color: COLORS.sky },
  { kind: "promise", label: "A promise", color: COLORS.sunflower },
  { kind: "fixed", label: "It's fixed", color: COLORS.mint },
  { kind: "greeting", label: "Small talk", color: COLORS.muted },
];

const STORIES: Array<{ id: string; text: string }> = [
  { id: "S1", text: "Three schools report scores not saving" },
  { id: "S2", text: "Timer bug, from report to \"it's working now\"" },
  { id: "S3", text: "A promise that is never kept" },
  { id: "S4", text: "A school moves its mock exam" },
  { id: "S5", text: "Request: export results to Excel" },
  { id: "S6", text: "Slow login that fixes itself" },
  { id: "S7", text: "An unclear \"it's working now\"" },
];

/**
 * Write into the group as anyone: what a teacher or the team would send on WhatsApp.
 * Same powers as the CLI: custom text, ready-made messages, and whole storylines.
 */
export function Composer({ groupId }: { groupId: string | undefined }) {
  const { api } = useLive();
  const { data: people } = useLiveQuery((a) => a.people());
  const [sender, setSender] = useState("chidi");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setSending(true);
    try {
      await action();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sticky bottom-28 z-10 mt-10">
      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK.map((quick) => (
          <button
            key={quick.kind}
            disabled={sending}
            onClick={() => void run(() => api.sendPrepared(groupId, quick.kind))}
            className="flex items-center gap-2 rounded-pill bg-[#1b1b21]/90 px-4 py-2 text-small text-muted backdrop-blur-xl transition-colors hover:text-foreground disabled:opacity-50"
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: quick.color }} />
            {quick.label}
          </button>
        ))}
        <StoryMenu onPlay={(id) => void run(() => api.playStory(groupId, id))} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(async () => {
            await api.say(groupId, sender, text);
            setText("");
          });
        }}
        className="flex items-center gap-2 rounded-pill bg-[#1b1b21]/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      >
        <select
          value={sender}
          onChange={(e) => setSender(e.target.value)}
          className="h-11 max-w-44 rounded-pill bg-surface-2 px-4 text-small text-sky outline-none"
          aria-label="Send as"
        >
          {(people?.cast ?? []).map((person) => (
            <option key={person.key} value={person.key}>
              {person.name}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write as them, e.g. the timer no dey show for SS2"
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-body text-foreground placeholder:text-faint outline-none"
          aria-label="Message"
        />
        <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
    </div>
  );
}

function StoryMenu({ onPlay }: { onPlay: (id: string) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-pill bg-[#1b1b21]/90 px-4 py-2 text-small text-muted backdrop-blur-xl transition-colors hover:text-foreground data-[state=open]:text-foreground">
        <BookOpen className="size-4" /> Play a story
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={8} className="z-50 w-80 rounded-card bg-[#1f1f25]/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {STORIES.map((story) => (
            <DropdownMenu.Item
              key={story.id}
              onSelect={() => onPlay(story.id)}
              className="flex cursor-pointer gap-3 rounded-chip px-4 py-3 text-small outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="font-medium text-sunflower">{story.id}</span>
              {story.text}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
