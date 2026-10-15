import { AnimatePresence } from "motion/react";
import { lazy, Suspense } from "react";
import { Backdrop } from "@/components/backdrop";
import { IssueSheet } from "@/components/issue-sheet";
import { NavPill } from "@/components/nav-pill";
import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveProvider, useLive } from "@/lib/live";
import { NavigationProvider, useNavigation } from "@/lib/navigation";
import { ProjectsProvider, useProjects } from "@/lib/projects";
import { AskPage } from "@/pages/ask";
import { ChatPage } from "@/pages/chat";
import { IssuesPage } from "@/pages/issues";
import { SettingsPage } from "@/pages/settings";
import { TodayPage } from "@/pages/today";

// The globe pulls in three.js, so it loads only when someone opens it.
const GlobePage = lazy(() => import("@/pages/globe").then((m) => ({ default: m.GlobePage })));

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
  const { page } = useNavigation();
  const { status } = useProjects();
  const { error } = useLive();
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
      {status && !status.hasApiKey && page !== "settings" && (
        <div role="alert" className="fixed top-24 left-1/2 z-30 max-w-xl -translate-x-1/2 rounded-card bg-sunflower/15 px-6 py-4 text-small text-sunflower">
          Add a free Groq API key in Settings so Loopkeeper can read the chat.
        </div>
      )}
      {error && (
        <div role="alert" className="fixed top-24 left-1/2 z-30 max-w-xl -translate-x-1/2 rounded-card bg-coral/15 px-6 py-4 text-small text-coral">
          Reading stopped: {error}
        </div>
      )}
    </div>
  );
}
