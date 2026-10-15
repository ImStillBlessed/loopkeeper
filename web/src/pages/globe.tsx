import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { GlobeGraph, type GlobeNode } from "@/components/globe-graph";
import { Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { NODE_COLORS, NODE_NAMES } from "@/lib/palette";

const KIND_NAMES: Record<string, string> = {
  Issue: "Issue",
  School: "School",
  Person: "Person",
  Message: "Message from the chat",
  Feature: "Product feature",
  CodeFile: "Code file",
  FollowUp: "Promise",
  Decision: "Decision",
  StatusChange: "Status change",
  Reminder: "Reminder",
  Group: "WhatsApp group",
};

/** The whole company brain as a small world. Answers and issues light up their path across it. */
export function GlobePage() {
  const { highlight, showOnGlobe, openIssue } = useNavigation();
  const { data } = useLiveQuery((api) => api.graph());
  const [selected, setSelected] = useState<GlobeNode>();

  return (
    <motion.main
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
      className="absolute inset-0"
    >
      <GlobeGraph data={data} highlight={highlight} onSelect={setSelected} />

      <div className="pointer-events-none absolute inset-x-0 bottom-28 flex items-end justify-between gap-8 px-10">
        <div className="pointer-events-auto">
          {highlight.length > 0 ? (
            <div className="flex items-center gap-4">
              <p className="text-title font-light">Showing the path behind your answer</p>
              <Button variant="secondary" size="sm" onClick={() => showOnGlobe([])}>
                Show everything
              </Button>
            </div>
          ) : (
            <p className="text-title font-light text-muted">
              <span className="text-foreground">{data?.nodes.length ?? 0}</span> things,{" "}
              <span className="text-foreground">{data?.links.length ?? 0}</span> connections
            </p>
          )}
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-small text-muted">
            {NODE_NAMES.map((kind) => (
              <li key={kind.label} className="flex items-center gap-2">
                <Dot color={kind.color} /> {kind.name}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.aside
            key={selected.id}
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="absolute top-28 right-8 w-[min(380px,calc(100vw-4rem))] rounded-card bg-[#1b1b21]/90 p-7 backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex items-center gap-2 text-small" style={{ color: NODE_COLORS[selected.label] }}>
                <Dot color={NODE_COLORS[selected.label] ?? "#999"} /> {KIND_NAMES[selected.label] ?? selected.label}
              </span>
              <button onClick={() => setSelected(undefined)} className="text-muted hover:text-foreground" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-3 text-lead font-medium text-pretty">{selected.name}</p>
            {selected.label === "Issue" && (
              <Button size="sm" className="mt-6" onClick={() => openIssue(selected.id)}>
                Open issue
              </Button>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </motion.main>
  );
}
