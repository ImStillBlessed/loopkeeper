import { Play, Square, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useLive } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";

/** Brand on the left, the live state and the one main action on the right. Nothing else. */
export function TopBar() {
  const live = useLive();
  const { go } = useNavigation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);

  const replay = async () => {
    setStarting(true);
    try {
      await live.replay("normal");
      go("chat");
    } finally {
      setStarting(false);
    }
  };

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between px-8 py-6">
      <button onClick={() => go("today")} className="pointer-events-auto flex items-center gap-3">
        <LoopMark />
        <span className="text-lead font-medium tracking-tight">Loopkeeper</span>
      </button>

      <div className="pointer-events-auto flex items-center gap-2">
        <AnimatePresence mode="popLayout">
          {live.running ? (
            <motion.div
              key="running"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-2"
            >
              <span className="flex h-12 items-center gap-3 rounded-pill bg-surface-1 px-5 text-small text-muted">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-mint" />
                </span>
                Reading the chat
                <span className="font-medium text-foreground tabular-nums">{live.seen}</span>
              </span>
              <Button variant="secondary" size="icon" onClick={() => void live.stop()} aria-label="Stop reading">
                <Square />
              </Button>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex items-center gap-2">
              <Tooltip content="Import your own WhatsApp export (.txt)">
                <Button variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label="Import a WhatsApp export">
                  <Upload />
                </Button>
              </Tooltip>
              <Button variant="secondary" onClick={() => void replay()} disabled={starting}>
                <Play /> Replay the group chat
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={fileInput}
          type="file"
          accept=".txt"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            await live.importExport(await file.text());
            go("chat");
          }}
        />
      </div>
    </header>
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
