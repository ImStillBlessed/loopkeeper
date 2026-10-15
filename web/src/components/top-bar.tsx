import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, FastForward, Pause, Radio, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useLive } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { useProjects } from "@/lib/projects";

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Brand and project on the left; the chat clock and the live connection on the right. */
export function TopBar() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-8 py-6">
      <div className="pointer-events-auto flex items-center gap-4">
        <LoopMark />
        <ProjectSwitcher />
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <ChatClock />
        <LiveControl />
      </div>
    </header>
  );
}

/** Which project everything on screen is about. Each project is its own FalkorDB graph. */
function ProjectSwitcher() {
  const { projects, current, switchTo } = useProjects();
  const { go } = useNavigation();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex h-12 items-center gap-2 rounded-pill px-4 text-lead font-medium tracking-tight transition-colors hover:bg-surface-1 data-[state=open]:bg-surface-1">
        {current?.name ?? "Loopkeeper"}
        <ChevronDown className="size-4 text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-64 rounded-card bg-[#1f1f25]/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl data-[state=open]:animate-[fade-in_200ms_ease-out]"
        >
          <DropdownMenu.Label className="px-4 pt-2 pb-1 text-small text-faint">Projects</DropdownMenu.Label>
          {projects.map((project) => (
            <DropdownMenu.Item
              key={project.id}
              onSelect={() => switchTo(project.id)}
              className="flex cursor-pointer items-center justify-between gap-6 rounded-chip px-4 py-3 outline-none data-[highlighted]:bg-surface-2"
            >
              <span>
                <span className="block text-body">{project.name}</span>
                <span className="block text-small text-faint">
                  {project.groups} {project.groups === 1 ? "group" : "groups"}, {project.repos} {project.repos === 1 ? "repo" : "repos"}
                </span>
              </span>
              {project.id === current?.id && <Check className="size-4 text-mint" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-2 h-px bg-hairline" />
          <DropdownMenu.Item
            onSelect={() => go("settings")}
            className="flex cursor-pointer items-center gap-3 rounded-chip px-4 py-3 text-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-foreground"
          >
            <Settings2 className="size-4" /> Manage projects
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The chat's own time. Fast-forwarding it is how a demo makes promises fall due. */
function ChatClock() {
  const { clock, advanceClock } = useLive();
  return (
    <div className="flex h-12 items-center gap-1 rounded-pill bg-surface-1 pr-1 pl-5 max-md:hidden">
      <span className="text-small text-muted tabular-nums">{CLOCK.format(clock)}</span>
      <Tooltip content="Fast-forward the chat a day">
        <Button variant="ghost" size="icon" className="size-10" onClick={() => void advanceClock(24)} aria-label="Fast-forward one day">
          <FastForward />
        </Button>
      </Tooltip>
    </div>
  );
}

/** Go live: the connected (simulated) WhatsApp group starts talking. */
function LiveControl() {
  const live = useLive();
  const { go } = useNavigation();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const groups = await live.api.groups();
      if (groups.length === 0) return go("settings");
      await live.goLive(live.liveGroupId ?? groups[0].id);
      go("chat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {live.live ? (
        <motion.div key="live" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} className="flex items-center gap-2">
          <span className="flex h-12 items-center gap-3 rounded-pill bg-mint/15 px-5 text-small font-medium text-mint">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-mint" />
            </span>
            Live
          </span>
          <Button variant="secondary" size="icon" onClick={() => void live.pause()} aria-label="Pause the live chat">
            <Pause />
          </Button>
        </motion.div>
      ) : (
        <motion.div key="idle" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}>
          <Button onClick={() => void start()} disabled={busy}>
            <Radio /> Go live
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The mark: a loop with a sunflower dot: one thread being kept. */
export function LoopMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="32" fill="none" stroke="#B39DFF" strokeWidth="14" />
      <circle cx="77" cy="25" r="12" fill="#FFC845" />
    </svg>
  );
}
