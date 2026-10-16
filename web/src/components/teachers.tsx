import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useState } from "react";
import { clientApi, type TeacherCaseState, type TeachersView } from "@/lib/api";
import { plural } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import type { Tone } from "@/lib/palette";
import { openTicket } from "@/lib/router";
import { Avatar } from "./desk";
import { ErrorNote, Panel } from "./page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const STATE: Record<TeacherCaseState | "quiet", { label: string; tone: Tone }> = {
  waiting_reply: { label: "Waiting for a reply", tone: "amber" },
  waiting_fix: { label: "Waiting for a fix", tone: "sky" },
  checking: { label: "Trying the fix", tone: "violet" },
  settled: { label: "Happy", tone: "green" },
  quiet: { label: "Quiet", tone: "neutral" },
};

type Case = TeachersView["cases"][number];

/**
 * The demo school's teachers, played by AI: who is waiting on what. They only react to Ednovax
 * (replies, tickets closed, fixes merged), so this is the other side of the conversation.
 * Shows nothing for a client whose people are real.
 */
export function TeachersPanel({ clientId }: { clientId: string }) {
  const { running } = useLive();
  const { data, error, reload } = useLiveQuery(() => clientApi(clientId).teachers(), [clientId]);
  const [note, setNote] = useState<string>();
  const [failure, setFailure] = useState<string>();
  if (!data || error) return null;

  const raise = async () => {
    setFailure(undefined);
    try {
      const { teacher } = await clientApi(clientId).raiseNextProblem();
      setNote(`${teacher} is writing…`);
      window.setTimeout(reload, 4000);
    } catch (e) {
      setFailure((e as Error).message);
    }
  };

  // Each teacher's latest problem that isn't settled, else their latest one.
  const caseOf = (name: string): Case | undefined => {
    const theirs = data.cases.filter((c) => c.teacher === name);
    return [...theirs].reverse().find((c) => c.state !== "settled") ?? theirs.at(-1);
  };

  return (
    <Panel
      title="The school's side"
      action={
        <Badge tone="violet">
          <Sparkles className="size-3.5" /> Played by AI
        </Badge>
      }
      bodyClassName="px-5 pb-5 sm:px-6"
    >
      <p className="mb-4 text-[13.5px] text-muted">
        {running ? "The teachers react to your replies, closed tickets and merged fixes." : "Press Go live and the teachers start talking."}
      </p>
      <ul className="flex flex-col gap-3">
        {data.teachers.map((teacher) => {
          const current = caseOf(teacher.name);
          const state = STATE[current?.state ?? "quiet"];
          return (
            <li key={teacher.key} className="flex gap-3">
              <Avatar name={teacher.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14px] font-semibold text-ink">{teacher.name}</span>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </div>
                <div className="text-[12.5px] text-muted">{teacher.job}</div>
                {current && current.state !== "settled" && (
                  <div className="mt-1 text-[13px] text-ink-2">
                    {current.situation}{" "}
                    {current.ticketId && (
                      <button onClick={() => openTicket(clientId, current.ticketId!)} className="font-semibold text-primary hover:underline">
                        Open ticket
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <span className="text-[12.5px] font-medium text-muted">
          {data.next ? `Next: ${data.next.teacher}, ${plural(data.remaining, "problem")} left` : "No problems left to raise"}
        </span>
        <Button size="sm" variant="outline" onClick={raise} disabled={!data.next}>
          <MessageSquarePlus /> Raise one now
        </Button>
      </div>
      {note && !failure && <p className="mt-2 text-[12.5px] font-medium text-green">{note}</p>}
      {failure && <ErrorNote message={failure} />}
    </Panel>
  );
}
