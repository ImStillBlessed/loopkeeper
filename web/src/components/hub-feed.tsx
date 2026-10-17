import { Clock, Send, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type HubEntry, type ImportProgress } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { cn } from "@/lib/utils";
import { Avatar } from "./desk";
import { ErrorNote, Loading } from "./page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { Select } from "./ui/select";

const METHOD: Record<HubEntry["method"], string> = {
  named: "named",
  contact: "known contact",
  thread: "same thread",
  model: "AI",
  manual: "by a person",
  "": "",
};

/** How many hub events have arrived, so lists refetch when the hub changes (an import reports at most once a second). */
function useHubTick(): number {
  const { events } = useLive();
  return useMemo(() => events.filter((e) => e.kind === "hub" || e.kind === "import").length, [events]);
}

/** The latest import's progress: from the event stream, or asked for when the page opens. */
function useImportProgress(): ImportProgress | null {
  const { events } = useLive();
  const [initial, setInitial] = useState<ImportProgress | null>(null);
  useEffect(() => {
    api.hubImport().then(setInitial, () => undefined);
  }, []);
  return useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.kind === "import") return event.progress;
    }
    return initial;
  }, [events, initial]);
}

/** The hub's pending count, refreshed on hub events (for badges). */
export function useHubPending(enabled: boolean): number {
  const tick = useHubTick();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    api.hub().then((h) => setPending(h.pending), () => undefined);
  }, [enabled, tick]);
  return pending;
}

/**
 * The central support hub: staff forward messages from every school into one group, and each one
 * shows where it was routed. Anything unclear waits here for a person.
 */
export function HubFeed({ className }: { className?: string }) {
  const tick = useHubTick();
  const hub = useLiveQuery(api.hub, [tick]);
  const clients = useLiveQuery(api.clients);
  const names = new Map((clients.data ?? []).map((c) => [c.id, c.name]));

  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const count = hub.data?.entries.length ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (hub.error) return <ErrorNote message={hub.error} />;
  if (!hub.data) return <Loading label="Loading the hub" />;

  return (
    <div className="flex flex-col">
      {hub.data.pending > 0 && (
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-2.5 text-[13px] text-muted">
          <Badge tone="amber">{hub.data.pending} to route</Badge>
          <span className="truncate">Messages the desk couldn't place.</span>
        </div>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cn("overflow-y-auto bg-paper-2/60 px-4 py-4 sm:px-6", className)}
      >
        {hub.data.entries.length === 0 && <p className="py-16 text-center text-muted">No hub messages yet. Forward one, or play the demo morning.</p>}
        <ul className="flex flex-col gap-3">
          {hub.data.entries.map((entry) => (
            <HubItem key={entry.id} entry={entry} names={names} clients={clients.data ?? []} onChanged={hub.reload} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function HubItem({ entry, names, clients, onChanged }: { entry: HubEntry; names: Map<string, string>; clients: Array<{ id: string; name: string }>; onChanged: () => void }) {
  const pending = entry.status === "pending";
  return (
    <li className={cn("flex gap-3", entry.status === "ignored" && "opacity-60")}>
      <Avatar name={entry.sender} staff />
      <div className={cn("min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3 shadow-card", pending ? "border-amber/40 bg-amber-soft" : "border-line-soft bg-card")}>
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-semibold">{entry.sender}</span>
          <span className="ml-auto shrink-0 text-[12px] text-faint tabular">{formatTime(entry.ts)}</span>
        </div>
        <p className="mt-0.5 line-clamp-3 text-[14px] text-ink-2">{entry.text}</p>
        <div className="mt-2">
          {entry.status === "routed" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.clientIds.map((id) => (
                <Badge key={id} tone="blue" className="max-w-full">
                  <span className="truncate">→ {names.get(id) ?? id}</span>
                </Badge>
              ))}
              {METHOD[entry.method] && <span className="text-[12px] font-semibold text-muted">{METHOD[entry.method]}</span>}
              {entry.reason && <span className="min-w-0 truncate text-[12px] text-faint">· {entry.reason}</span>}
            </div>
          )}
          {entry.status === "ignored" && <span className="text-[12px] text-muted">Team chatter, not routed</span>}
          {pending && <RouteControls entry={entry} clients={clients} onChanged={onChanged} />}
        </div>
      </div>
    </li>
  );
}

function RouteControls({ entry, clients, onChanged }: { entry: HubEntry; clients: Array<{ id: string; name: string }>; onChanged: () => void }) {
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber">
        <Clock className="size-3.5" /> Waiting for a person
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Route to client"
          size="sm"
          value={clientId}
          placeholder="Choose a client…"
          onValueChange={setClientId}
          className="min-w-0 flex-1 sm:flex-none sm:min-w-48"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Button size="sm" disabled={!clientId || busy} onClick={() => act(() => api.routeHubMessage(entry.id, [clientId]))}>
          Route
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.ignoreHubMessage(entry.id))}>
          Not about a client
        </Button>
      </div>
      {error && <ErrorNote message={error} />}
    </div>
  );
}

/** Write in the hub, play the demo morning, or import an exported hub chat. */
export function HubComposer() {
  const user = useUser();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const progress = useImportProgress();

  const run = async (action: () => Promise<string | void>) => {
    setError(undefined);
    setNote(undefined);
    try {
      const message = await action();
      if (message) setNote(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = () =>
    run(async () => {
      if (!text.trim()) return;
      await api.sayInHub(user.name, text.trim());
      setText("");
    });

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
        rows={3}
        placeholder="Write in the hub as you. Try: Mrs Igbinoba (Henson): results won't load"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={send} disabled={!text.trim()}>
          <Send /> Send to hub
        </Button>
        <Button size="sm" variant="outline" onClick={() => file.current?.click()} disabled={progress?.state === "running"}>
          <Upload /> Import hub chat (.txt)
        </Button>
        <input
          ref={file}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen) void run(async () => void (await api.importHub(await chosen.text())));
          }}
        />
      </div>
      {progress && <ImportStatus progress={progress} />}
      {note && <p className="text-[13px] text-green">{note}</p>}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

const IMPORT_STATE: Record<ImportProgress["state"], string> = {
  running: "Importing the hub chat",
  done: "Hub chat imported",
  stopped: "Import stopped. Import the same file again to carry on.",
  failed: "The import stopped with an error",
};

/** A running (or finished) import: how far it is and where the messages went. */
function ImportStatus({ progress }: { progress: ImportProgress }) {
  const [stopping, setStopping] = useState(false);
  const running = progress.state === "running";
  const share = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const counts = [
    `${progress.routed.toLocaleString()} routed`,
    `${progress.pending.toLocaleString()} to route by hand`,
    `${progress.ignored.toLocaleString()} team chatter`,
    progress.skipped ? `${progress.skipped.toLocaleString()} already imported` : "",
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-line-soft bg-paper px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[13.5px] font-semibold">{IMPORT_STATE[progress.state]}</span>
        <span className="ml-auto text-[12.5px] text-muted tabular">
          {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-[width]", progress.state === "failed" ? "bg-red" : "bg-primary")} style={{ width: `${share}%` }} />
      </div>
      <p className="mt-2 text-[12.5px] text-muted">{counts.join(", ")}</p>
      {running && <p className="mt-1 text-[12.5px] text-muted">Each message also goes through its client's pipeline, so this runs at the pace the AI can read them. You can leave this page.</p>}
      {progress.error && <ErrorNote message={progress.error} />}
      {running && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void api.stopHubImport().finally(() => setStopping(false));
          }}
        >
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      )}
    </div>
  );
}
