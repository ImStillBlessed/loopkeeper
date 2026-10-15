import { GitPullRequest, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { SeverityBadge, StatusBadge } from "@/components/desk";
import { Empty, ErrorNote, Loading, Page, PageHeader, Panel, Segmented } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api, type Pattern } from "@/lib/api";
import { formatShortDay, plural } from "@/lib/format";
import { useLiveQuery } from "@/lib/live";
import { PRODUCT_NAMES } from "@/lib/palette";
import { openTicket } from "@/lib/router";

type Filter = "active" | "resolved" | "all";

const isActive = (pattern: Pattern) => pattern.signals.some((s) => s.status !== "resolved" && s.status !== "merged");

/** Problems several clients share, found by meaning, without any client seeing another's messages. */
export function PatternsPage() {
  const { data, error } = useLiveQuery(() => api.patterns());
  const [filter, setFilter] = useState<Filter>("active");
  const shown = (data ?? []).filter((p) => (filter === "all" ? true : filter === "active" ? isActive(p) : !isActive(p)));

  return (
    <Page>
      <PageHeader
        title="Patterns"
        lead="The same problem at different clients, matched by meaning."
        actions={
          <Segmented
            label="Show patterns"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "active", label: "Active" },
              { id: "resolved", label: "Resolved" },
              { id: "all", label: "All" },
            ]}
          />
        }
      />

      <div className="mb-7 flex items-start gap-4 rounded-2xl bg-green-soft px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-green shadow-card">
          <ShieldCheck className="size-4.5" />
        </span>
        <p className="text-[14px] leading-relaxed">
          <span className="font-semibold text-ink">Private by design.</span> No messages or names are shared between clients. Clients you don't look after show as "Another client".
        </p>
      </div>

      {error && <ErrorNote message={error} />}
      {!data && !error && <Loading />}
      {data && shown.length === 0 && (
        <div className="card">
          <Empty title={filter === "resolved" ? "No resolved patterns yet" : "No shared problems right now"}>
            When two clients report the same problem, it shows up here, so one fix can go out to all of them.
          </Empty>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {shown.map((pattern) => (
          <PatternPanel key={pattern.id} pattern={pattern} />
        ))}
      </div>
    </Page>
  );
}

function PatternPanel({ pattern }: { pattern: Pattern }) {
  const statuses = [...new Set(pattern.signals.map((s) => s.status))];
  return (
    <Panel
      title={
        <span className="block min-w-0">
          <span className="block truncate">{pattern.feature || "Feature"}</span>
          {pattern.product && <span className="block truncate text-[13px] font-medium text-muted">{PRODUCT_NAMES[pattern.product] ?? pattern.product}</span>}
        </span>
      }
      action={<Badge tone={isActive(pattern) ? "red" : "green"}>{isActive(pattern) ? "Active" : "Resolved"}</Badge>}
    >
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-[22px]">{pattern.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
          <span className="font-medium text-ink">{plural(pattern.clients, "client")} affected</span>
          <span>First seen {formatShortDay(pattern.createdAt)}</span>
          <span className="flex gap-1.5">
            {statuses.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </span>
        </div>
      </div>

      <table className="mt-2 w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-line-soft">
            <th className="label py-2 pl-5 font-medium">Client</th>
            <th className="label py-2 font-medium">Their ticket</th>
            <th className="label py-2 pr-4 font-medium">Status</th>
            <th className="label hidden py-2 font-medium sm:table-cell">Severity</th>
            <th className="label hidden py-2 pr-5 text-right font-medium sm:table-cell">Reported</th>
          </tr>
        </thead>
        <tbody>
          {pattern.signals.map((signal, index) => {
            const visible = Boolean(signal.issueId);
            return (
              <tr
                key={signal.issueId || index}
                onClick={visible ? () => openTicket(signal.clientId, signal.issueId) : undefined}
                className={visible ? "cursor-pointer border-b border-line-soft hover:bg-paper-2" : "border-b border-line-soft"}
              >
                <td className={visible ? "py-2.5 pr-3 pl-5 align-top font-medium" : "py-2.5 pr-3 pl-5 align-top text-muted italic"}>{signal.clientName}</td>
                <td className="py-2.5 pr-4 align-top text-[14px]">
                  <span className="line-clamp-2">{signal.title}</span>
                </td>
                <td className="py-2.5 pr-4 align-top">
                  <StatusBadge status={signal.status} />
                </td>
                <td className="hidden py-2.5 sm:table-cell">
                  <SeverityBadge severity={signal.severity} />
                </td>
                <td className="hidden py-2.5 pr-5 text-right text-[12.5px] font-medium text-muted sm:table-cell">{formatShortDay(signal.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="px-5 py-4">
        {pattern.pullRequests.length === 0 ? (
          <p className="text-[13.5px] text-muted">No fix yet. When one ships, every client here is told.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pattern.pullRequests.map((pr) => (
              <li key={pr.number} className="flex items-center gap-2 text-[14px]">
                <GitPullRequest className="size-4 text-primary" />
                <a href={pr.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                  #{pr.number} {pr.title}
                </a>
                <Badge tone={pr.state === "merged" ? "green" : "blue"}>{pr.state}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
