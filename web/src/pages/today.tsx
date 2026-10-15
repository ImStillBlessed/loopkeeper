import { Play } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { Headline, Page } from "@/components/page";
import { FeaturesRail, LatestRail, SchoolsRail } from "@/components/rails";
import { Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BoardIssue, FollowUpsResponse } from "@/lib/api";
import { plural, shortName } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { useNavigation } from "@/lib/navigation";
import { COLORS } from "@/lib/palette";

const NUMBER_WORDS = ["No", "One", "Two", "Three"];
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const DAY = 24 * 60 * 60 * 1000;

/** The glance: one sentence, and at most three things that need a person. */
export function TodayPage() {
  const live = useLive();
  const { go, openIssue } = useNavigation();
  const { data: issues } = useLiveQuery((api) => api.board());
  const { data: promises } = useLiveQuery((api) => api.followUps());

  const cards = buildCards(issues ?? [], promises, { openIssue, goToIssues: () => go("issues") });
  const nothingYet = live.seen === 0 && (issues?.length ?? 0) === 0;

  return (
    <Page
      left={<LatestRail />}
      right={
        <>
          <SchoolsRail issues={issues ?? []} />
          <FeaturesRail issues={issues ?? []} />
        </>
      }
    >
      {live.live ? (
        <>
          <Headline>Reading the group chat.</Headline>
          <p className="mt-8 text-title font-light text-muted">
            <span className="text-foreground tabular-nums">{live.seen}</span> messages so far,{" "}
            <span className="text-foreground tabular-nums">{live.ignored}</span> of them small talk.
          </p>
        </>
      ) : nothingYet ? (
        <EmptyState onStart={async () => (await live.goLive(), go("chat"))} />
      ) : (
        <Headline>{cards.length === 0 ? "Every loop is closed." : `${NUMBER_WORDS[cards.length]} ${cards.length === 1 ? "thing needs" : "things need"} you today.`}</Headline>
      )}

      {!nothingYet && (
        <div className="mt-16 flex flex-col gap-4">
          {cards.map((card, index) => (
            <motion.button
              key={card.key}
              onClick={card.onClick}
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.08, duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              className="group flex w-full items-center gap-6 rounded-card bg-surface-1 p-8 text-left transition-colors duration-300 hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 text-small" style={{ color: card.color }}>
                  <Dot color={card.color} /> {card.kind}
                </div>
                <h2 className="mt-3 text-title font-medium text-balance">{card.title}</h2>
                <p className="mt-2 text-lead text-muted">{card.detail}</p>
              </div>
              {card.aside}
            </motion.button>
          ))}
        </div>
      )}

      {!nothingYet && !live.live && (
        <p className="mt-16 text-lead text-faint">
          Loopkeeper has read {plural(live.seen, "message")} and set {live.ignored} aside as small talk.
        </p>
      )}
    </Page>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <>
      <Headline>Nothing read yet.</Headline>
      <p className="mt-8 max-w-xl text-title font-light text-muted text-pretty">
        Replay three weeks of a school support group on WhatsApp and watch every problem, promise and decision get picked up.
      </p>
      <Button size="lg" className="mt-12" onClick={onStart}>
        <Play /> Replay the group chat
      </Button>
    </>
  );
}

interface Card {
  key: string;
  kind: string;
  color: string;
  title: string;
  detail: string;
  aside?: ReactNode;
  onClick: () => void;
}

function buildCards(
  issues: BoardIssue[],
  promises: FollowUpsResponse | undefined,
  actions: { openIssue: (id: string) => void; goToIssues: () => void },
): Card[] {
  const cards: Card[] = [];

  // The open problem that reaches the most schools.
  const [biggest] = issues
    .filter((i) => i.status === "open" || i.status === "in_progress")
    .sort((a, b) => b.schools.length - a.schools.length || (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  if (biggest) {
    cards.push({
      key: biggest.id,
      kind: biggest.schools.length > 1 ? "Biggest problem" : "Open problem",
      color: COLORS.coral,
      title: biggest.title,
      detail: biggest.schools.length > 1 ? `Reported by ${biggest.schools.length} schools` : `Reported by ${biggest.schools[0] ?? "the group"}`,
      aside: biggest.owner ? <OwnerAside name={biggest.owner} /> : undefined,
      onClick: () => actions.openIssue(biggest.id),
    });
  }

  // The most overdue promise.
  const [overdue] = (promises?.followUps ?? []).filter((f) => f.status === "overdue").sort((a, b) => a.dueAt - b.dueAt);
  if (overdue && promises) {
    const days = Math.max(1, Math.floor((promises.now - overdue.dueAt) / DAY));
    cards.push({
      key: overdue.id,
      kind: "Promise not kept",
      color: COLORS.sunflower,
      title: `${shortName(overdue.owner)}: ${overdue.text.charAt(0).toLowerCase()}${overdue.text.slice(1)}`,
      detail: `${plural(days, "day")} overdue. Loopkeeper has sent a reminder.`,
      aside: <OwnerAside name={overdue.owner} label="Waiting on" />,
      onClick: actions.goToIssues,
    });
  }

  // Fixes nobody has confirmed yet.
  const unconfirmed = issues.filter((i) => i.status === "possibly_resolved");
  if (unconfirmed.length) {
    cards.push({
      key: "unconfirmed",
      kind: "Might be fixed",
      color: COLORS.mint,
      title: unconfirmed.length === 1 ? unconfirmed[0].title : `${unconfirmed.length} issues might be fixed`,
      detail: "A teacher said it works now, but it wasn't clear which problem they meant. Check with the school.",
      onClick: () => (unconfirmed.length === 1 ? actions.openIssue(unconfirmed[0].id) : actions.goToIssues()),
    });
  }

  return cards;
}

function OwnerAside({ name, label = "Owner" }: { name: string; label?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 max-sm:hidden">
      <Avatar name={name} className="size-14 text-lead" />
      <span className="text-small text-faint">{label}</span>
    </div>
  );
}
