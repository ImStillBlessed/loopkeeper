import { ArrowRight, ChevronDown, Globe2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { api, type IssueDetail } from "@/lib/api";
import { formatShortDay, formatTime, plural } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS, STATUS, type StatusKey } from "@/lib/palette";

/** Everything about one issue: the story from the chat, where it lives in the code, and how it changed. */
export function IssueSheet() {
  const { openIssueId, openIssue, showOnGlobe } = useNavigation();
  const live = useLive();
  const [detail, setDetail] = useState<IssueDetail>();

  useEffect(() => {
    if (!openIssueId) return;
    api.issue(openIssueId).then(setDetail).catch(() => setDetail(undefined));
  }, [openIssueId, live.version]);

  const visible = detail && detail.issue.id === openIssueId;
  const status = visible ? STATUS[detail.issue.status as StatusKey] : undefined;
  const reporting = visible ? detail.impact.filter((s) => s.hasReported).length : 0;

  const setStatus = async (to: string) => {
    if (!openIssueId) return;
    await api.setStatus(openIssueId, to);
    live.touch();
  };

  return (
    <Sheet open={Boolean(openIssueId)} onOpenChange={(open) => !open && openIssue(undefined)}>
      {openIssueId && (
        <SheetContent
          title={visible ? detail.issue.title : "Loading…"}
          description={
            visible && status ? (
              <span className="flex flex-wrap items-center gap-3">
                <Badge color={status.color}>{status.label}</Badge>
                {reporting > 0 && <span>Reported by {plural(reporting, "school")}</span>}
              </span>
            ) : undefined
          }
        >
          {visible && (
            <div className="flex flex-col gap-12">
              <p className="text-lead text-muted text-pretty">{detail.issue.summary}</p>

              <div className="flex flex-wrap gap-3">
                {detail.issue.status === "possibly_resolved" && (
                  <>
                    <Button onClick={() => void setStatus("resolved")}>Confirm it's fixed</Button>
                    <Button variant="secondary" onClick={() => void setStatus("open")}>Still broken</Button>
                  </>
                )}
                {detail.issue.status === "open" && (
                  <Button variant="secondary" onClick={() => void setStatus("in_progress")}>Mark as being worked on</Button>
                )}
                {detail.issue.status === "resolved" && (
                  <Button variant="secondary" onClick={() => void setStatus("open")}>Reopen</Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() =>
                    showOnGlobe([
                      detail.issue.id,
                      ...(detail.code?.featureKey ? [detail.code.featureKey] : []),
                      ...(detail.code?.files ?? []),
                      ...detail.messages.map((m) => m.id),
                      ...detail.impact.filter((s) => s.hasReported).map((s) => s.schoolId),
                    ])
                  }
                >
                  <Globe2 /> See on the globe
                </Button>
              </div>

              <Section title="From the chat">
                <Messages messages={detail.messages} />
              </Section>

              {detail.code?.feature && (
                <Section title="Where it lives">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge color={COLORS.lilac} className="px-4 py-2 text-body">{detail.code.feature}</Badge>
                    <ArrowRight className="size-5 text-faint" />
                    <span className="flex flex-wrap gap-2">
                      {detail.code.files.slice(0, 3).map((file) => (
                        <span key={file} className="rounded-chip bg-surface-1 px-3 py-1.5 text-small text-muted">{file}</span>
                      ))}
                    </span>
                    {(detail.code.assignee ?? detail.code.codeOwners[0]) && (
                      <>
                        <ArrowRight className="size-5 text-faint" />
                        <span className="flex items-center gap-3">
                          <Avatar name={detail.code.assignee ?? detail.code.codeOwners[0]} />
                          <span className="text-body">{detail.code.assignee ?? detail.code.codeOwners[0]}</span>
                        </span>
                      </>
                    )}
                  </div>
                </Section>
              )}

              {detail.impact.length > 0 && (
                <Section title="Schools using this feature">
                  <div className="flex flex-wrap gap-2">
                    {detail.impact.map((s) => (
                      <Badge key={s.schoolId} color={s.hasReported ? COLORS.sunflower : COLORS.muted} className="px-4 py-2 text-body">
                        {s.school}
                        {s.hasReported && <span className="text-small opacity-70">reported it</span>}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {detail.history.length > 0 && (
                <Section title="What changed">
                  <History history={detail.history} />
                </Section>
              )}
            </div>
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-5 text-lead font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** The first three messages tell the story; the rest are one tap away. */
function Messages({ messages }: { messages: IssueDetail["messages"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? messages : messages.slice(0, 3);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((m) => (
        <div key={m.id} className="rounded-card rounded-tl-md bg-surface-1 px-5 py-4">
          <div className="flex items-baseline justify-between gap-4 text-small">
            <span className="font-medium text-sky">
              {m.sender}
              {m.school && <span className="font-normal text-faint"> at {m.school}</span>}
            </span>
            <span className="shrink-0 text-faint">{formatShortDay(m.ts)}, {formatTime(m.ts)}</span>
          </div>
          <p className="mt-1.5 text-body text-pretty">{m.text || "Sent a photo"}</p>
        </div>
      ))}
      {messages.length > 3 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${messages.length} messages`}
          <ChevronDown className={`transition-transform duration-300 ${all ? "rotate-180" : ""}`} />
        </Button>
      )}
    </div>
  );
}

function History({ history }: { history: IssueDetail["history"] }) {
  const [open, setOpen] = useState(false);
  const latest = history.at(-1)!;
  const label = (key: string) => STATUS[key as StatusKey]?.label ?? key;

  const entry = (h: IssueDetail["history"][number]) => (
    <div key={`${h.at}-${h.to}`} className="border-l-2 pl-5" style={{ borderColor: STATUS[h.to as StatusKey]?.color ?? COLORS.muted }}>
      <p className="text-body font-medium">
        {label(h.from)} to {label(h.to).toLowerCase()}
      </p>
      <p className="mt-1 text-small text-muted">
        {h.by}, {formatShortDay(h.at)}
        {h.confidence < 1 && `, ${Math.round(h.confidence * 100)}% sure`}
      </p>
      {h.because && <p className="mt-2 text-body text-pretty text-muted">“{h.because}”</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {entry(latest)}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex flex-col gap-6 overflow-hidden">
            {history.slice(0, -1).reverse().map(entry)}
          </motion.div>
        )}
      </AnimatePresence>
      {history.length > 1 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(!open)}>
          {open ? "Hide earlier changes" : `Show ${plural(history.length - 1, "earlier change")}`}
        </Button>
      )}
    </div>
  );
}
