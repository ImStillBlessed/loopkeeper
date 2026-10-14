import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { Page } from "@/components/page";
import { FeaturesRail, SchoolsRail } from "@/components/rails";
import { Segmented } from "@/components/segmented";
import { Badge, Dot } from "@/components/ui/badge";
import { api, type BoardIssue, type FollowUpsResponse } from "@/lib/api";
import { formatShortDay } from "@/lib/format";
import { useLiveQuery } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS, STATUS, type StatusKey } from "@/lib/palette";

type View = "issues" | "promises" | "decisions";
const ACTIVE: StatusKey[] = ["possibly_resolved", "open", "in_progress"];

export function IssuesPage() {
  const [view, setView] = useState<View>("issues");
  const { data: issues } = useLiveQuery(api.board);
  const { data: promises } = useLiveQuery(api.followUps);

  return (
    <Page left={<SchoolsRail issues={issues ?? []} />} right={<FeaturesRail issues={issues ?? []} />}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="text-headline font-light tracking-tight">
          {view === "issues" ? "Issues" : view === "promises" ? "Promises" : "Decisions"}
        </h1>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "issues", label: "Issues" },
            { value: "promises", label: "Promises" },
            { value: "decisions", label: "Decisions" },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="mt-14"
        >
          {view === "issues" && <IssueList issues={issues ?? []} />}
          {view === "promises" && <PromiseList data={promises} />}
          {view === "decisions" && <DecisionList data={promises} />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}

function IssueList({ issues }: { issues: BoardIssue[] }) {
  const [showResolved, setShowResolved] = useState(false);
  const resolved = issues.filter((i) => i.status === "resolved");

  if (issues.length === 0) return <Empty text="No issues yet. Replay the group chat to fill this page." />;

  return (
    <div className="flex flex-col gap-12">
      {ACTIVE.map((status) => {
        const group = issues.filter((i) => i.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status}>
            <GroupTitle color={STATUS[status].color} label={STATUS[status].label} count={group.length} />
            <div className="mt-4 flex flex-col gap-2">
              {group.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
            </div>
          </section>
        );
      })}

      {resolved.length > 0 && (
        <section>
          <button onClick={() => setShowResolved(!showResolved)} className="flex items-center gap-3" aria-expanded={showResolved}>
            <GroupTitle color={STATUS.resolved.color} label={STATUS.resolved.label} count={resolved.length} />
            <ChevronDown className={`size-5 text-muted transition-transform duration-300 ${showResolved ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {showResolved && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 flex flex-col gap-2">
                  {resolved.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: BoardIssue }) {
  const { openIssue } = useNavigation();
  return (
    <motion.button
      layout
      onClick={() => openIssue(issue.id)}
      whileTap={{ scale: 0.985 }}
      className="flex w-full items-center gap-5 rounded-card px-6 py-5 text-left transition-colors duration-300 hover:bg-surface-1"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-lead font-medium text-pretty">{issue.title}</h3>
        <p className="mt-1 text-small text-muted">
          {issue.schools.length > 1 ? `${issue.schools.length} schools` : issue.schools[0] ?? "Ednovax team"}
          {issue.merged > 0 && `, merged from ${issue.merged + 1} reports`}
        </p>
      </div>
      {issue.owner && <Avatar name={issue.owner} />}
    </motion.button>
  );
}

function PromiseList({ data }: { data: FollowUpsResponse | undefined }) {
  const promises = data?.followUps ?? [];
  if (promises.length === 0) return <Empty text="No open promises. Every commitment made in the chat has been kept." />;
  return (
    <div className="flex flex-col gap-2">
      {promises.map((p) => {
        const overdue = p.status === "overdue";
        return (
          <div key={p.id} className="flex items-center gap-5 rounded-card px-6 py-5">
            <Avatar name={p.owner} />
            <div className="min-w-0 flex-1">
              <h3 className="text-lead font-medium text-pretty">{p.text}</h3>
              <p className="mt-1 text-small text-muted">{p.owner}, due {formatShortDay(p.dueAt)}</p>
            </div>
            <Badge color={overdue ? COLORS.coral : COLORS.sunflower}>{overdue ? "Overdue" : "Due soon"}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function DecisionList({ data }: { data: FollowUpsResponse | undefined }) {
  const decisions = data?.decisions ?? [];
  if (decisions.length === 0) return <Empty text="No decisions recorded yet." />;
  return (
    <div className="flex flex-col gap-8">
      {decisions.map((d) => (
        <div key={d.id} className="border-l-2 border-mint/60 pl-6">
          <p className="text-title font-light text-pretty">{d.text}</p>
          <p className="mt-2 text-small text-muted">
            Agreed by {d.by} on {formatShortDay(d.ts)}
          </p>
        </div>
      ))}
    </div>
  );
}

function GroupTitle({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <h2 className="flex items-center gap-3 text-lead font-medium">
      <Dot color={color} />
      {label}
      <span className="font-normal text-faint">{count}</span>
    </h2>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-title font-light text-muted">{text}</p>;
}

