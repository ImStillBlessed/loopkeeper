import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Backdrop } from "@/components/backdrop";
import { IssueSheet } from "@/components/issue-sheet";
import { NavPill } from "@/components/nav-pill";
import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveProvider, useLive } from "@/lib/live";
import { NavigationProvider, useNavigation } from "@/lib/navigation";
import { ProjectsProvider, useProjects } from "@/lib/projects";
import { ChatPage } from "@/pages/chat";
import { IssuesPage } from "@/pages/issues";
import { SettingsPage } from "@/pages/settings";
import { TodayPage } from "@/pages/today";

// The globe (three.js) and Ask (Markdown + code highlighting) are heavy, so they load when opened.
const GlobePage = lazy(() => import("@/pages/globe").then((m) => ({ default: m.GlobePage })));
const AskPage = lazy(() => import("@/pages/ask").then((m) => ({ default: m.AskPage })));

const PAGES = { today: TodayPage, chat: ChatPage, issues: IssuesPage, globe: GlobePage, ask: AskPage, settings: SettingsPage };

export function App() {
  return (
    <ProjectsProvider>
      <NavigationProvider>
        <TooltipProvider>
          <ProjectScope />
        </TooltipProvider>
      </NavigationProvider>
    </ProjectsProvider>
  );
}

/** Everything below is about one project. Switching project remounts it, so no state leaks across. */
function ProjectScope() {
  const { current } = useProjects();
  if (!current) {
    return (
      <div className="grid h-full place-items-center text-lead text-muted">
        <Backdrop />
        <p className="relative">Connecting to Loopkeeper…</p>
      </div>
    );
  }
  return (
    <LiveProvider key={current.id} project={current.id}>
      <Shell />
    </LiveProvider>
  );
}

function Shell() {
  const { page, go } = useNavigation();
  const { status } = useProjects();
  const { error, dismissError } = useLive();
  const [keyNoticeHidden, setKeyNoticeHidden] = useState(false);
  const Current = PAGES[page];

  return (
    <div className="relative h-full overflow-hidden">
      {page !== "globe" && <Backdrop />}
      <TopBar />
      <Suspense fallback={null}>
        <AnimatePresence mode="wait">
          <Current key={page} />
        </AnimatePresence>
      </Suspense>
      <NavPill />
      <IssueSheet />
      <AnimatePresence>
        {error ? (
          <Banner key="error" tone="coral" onClose={dismissError} action={{ label: "Open Settings", onClick: () => (dismissError(), go("settings")) }}>
            {error}
          </Banner>
        ) : (
          status &&
          !status.hasApiKey &&
          !keyNoticeHidden &&
          page !== "settings" && (
            <Banner key="key" tone="sunflower" onClose={() => setKeyNoticeHidden(true)} action={{ label: "Add a key", onClick: () => go("settings") }}>
              Add a free Groq API key so Loopkeeper can read the chat.
            </Banner>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

/** A notice under the top bar that can always be closed. */
function Banner({ tone, children, onClose, action }: { tone: "coral" | "sunflower"; children: ReactNode; onClose: () => void; action?: { label: string; onClick: () => void } }) {
  const colors = tone === "coral" ? "bg-[#3a1f22]/95 text-coral" : "bg-[#3a3220]/95 text-sunflower";
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      className={`fixed top-24 left-1/2 z-30 flex w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-4 rounded-card py-3 pr-3 pl-6 text-small shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl ${colors}`}
    >
      <p className="flex-1">{children}</p>
      {action && (
        <button onClick={action.onClick} className="shrink-0 rounded-pill px-3 py-1.5 font-medium hover:bg-white/10">
          {action.label}
        </button>
      )}
      <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
        <X className="size-4" />
      </button>
    </motion.div>
  );
}
