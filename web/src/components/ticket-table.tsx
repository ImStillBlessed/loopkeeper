import { Flag } from "lucide-react";
import type { Ticket } from "@/lib/api";
import { ago } from "@/lib/format";
import { KIND } from "@/lib/palette";
import { openTicket } from "@/lib/router";
import { cn } from "@/lib/utils";
import { MoodMark, SeverityBadge, SlaTimer, StatusBadge } from "./desk";
import { Tooltip } from "./ui/tooltip";

/**
 * Tickets as a dense table: one row per ticket, the SLA timer always visible.
 * Clicking a row opens the ticket drawer (it lives in the URL, so links can be shared).
 */
export function TicketTable({ tickets, now, showClient = true, empty }: { tickets: Ticket[]; now: number; showClient?: boolean; empty?: React.ReactNode }) {
  if (tickets.length === 0) return <>{empty}</>;
  return (
    <>
      <TicketCards tickets={tickets} now={now} showClient={showClient} />
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <Th className="w-[44%]">Ticket</Th>
            {showClient && <Th>Client</Th>}
            <Th>Status</Th>
            <Th>Severity</Th>
            <Th>SLA</Th>
            <Th>Owner</Th>
            <Th className="text-right">Updated</Th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr
              key={`${ticket.clientId}:${ticket.id}`}
              onClick={() => openTicket(ticket.clientId, ticket.id)}
              className={cn("group cursor-pointer border-b border-line-soft transition-colors last:border-b-0 hover:bg-primary-soft/40", ticket.sla.state === "breached" && "bg-red-soft/40")}
            >
              <td className="py-4 pr-4 pl-6">
                <div className="flex items-center gap-2">
                  {ticket.escalated && (
                    <Tooltip content="Escalated to the support lead">
                      <Flag className="size-3.5 shrink-0 fill-red text-red" />
                    </Tooltip>
                  )}
                  <button className="truncate text-left font-medium group-hover:text-primary" onClick={(e) => (e.stopPropagation(), openTicket(ticket.clientId, ticket.id))}>
                    {ticket.title}
                  </button>
                  <MoodMark moods={ticket.moods} />
                </div>
                <div className="mt-1 text-[12.5px] text-faint">
                  {KIND[ticket.kind] ?? ticket.kind} · {ticket.messages} {ticket.messages === 1 ? "message" : "messages"}
                  {ticket.merged > 0 && ` · ${ticket.merged} merged`}
                </div>
              </td>
              {showClient && <td className="py-4 pr-4 text-[14px] whitespace-nowrap">{ticket.clientName}</td>}
              <td className="py-4 pr-4">
                <StatusBadge status={ticket.status} />
              </td>
              <td className="py-4 pr-4">
                <SeverityBadge severity={ticket.severity} />
              </td>
              <td className="py-4 pr-4">
                <SlaTimer sla={ticket.sla} now={now} compact />
              </td>
              <td className="py-4 pr-4 text-[14px] whitespace-nowrap text-ink-2">{ticket.owner || <span className="text-faint">Unassigned</span>}</td>
              <td className="py-4 pr-6 text-right text-[13px] whitespace-nowrap text-muted">{ago(ticket.updatedAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

/** On phones: one compact card per ticket. Title (two lines at most), then status, SLA and who. */
function TicketCards({ tickets, now, showClient }: { tickets: Ticket[]; now: number; showClient: boolean }) {
  return (
    <ul className="md:hidden">
      {tickets.map((ticket) => (
        <li key={`${ticket.clientId}:${ticket.id}`} className="border-b border-line-soft last:border-b-0">
          <button
            onClick={() => openTicket(ticket.clientId, ticket.id)}
            className={cn("flex w-full flex-col gap-2 px-4 py-3.5 text-left active:bg-paper", ticket.sla.state === "breached" && "bg-red-soft/40")}
          >
            <div className="flex items-start gap-2">
              {ticket.escalated && <Flag className="mt-1 size-3.5 shrink-0 fill-red text-red" />}
              <span className="line-clamp-2 font-medium">{ticket.title}</span>
              <MoodMark moods={ticket.moods} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <StatusBadge status={ticket.status} />
              <SlaTimer sla={ticket.sla} now={now} compact />
            </div>
            <div className="truncate text-[12.5px] text-muted">
              {showClient && `${ticket.clientName} · `}
              {ticket.owner || "Unassigned"} · {ago(ticket.updatedAt, now)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("label bg-paper/60 py-3 pr-4 first:pl-6 last:pr-6", className)}>{children}</th>;
}
