import { AnimatePresence } from "motion/react";
import { lazy, Suspense } from "react";
import { Backdrop } from "@/components/backdrop";
import { IssueSheet } from "@/components/issue-sheet";
import { NavPill } from "@/components/nav-pill";
import { TopBar } from "@/components/top-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveProvider, useLive } from "@/lib/live";
import { NavigationProvider, useNavigation } from "@/lib/navigation";
import { AskPage } from "@/pages/ask";
import { ChatPage } from "@/pages/chat";
import { IssuesPage } from "@/pages/issues";
import { TodayPage } from "@/pages/today";

// The globe pulls in three.js, so it loads only when someone opens it.
const GlobePage = lazy(() => import("@/pages/globe").then((m) => ({ default: m.GlobePage })));

const PAGES = { today: TodayPage, chat: ChatPage, issues: IssuesPage, globe: GlobePage, ask: AskPage };

export function App() {
  return (
    <LiveProvider>
      <NavigationProvider>
        <TooltipProvider>
          <Shell />
        </TooltipProvider>
      </NavigationProvider>
    </LiveProvider>
  );
}

function Shell() {
  const { page } = useNavigation();
  const { hasApiKey, error } = useLive();
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
      {(!hasApiKey || error) && (
        <div role="alert" className="fixed top-24 left-1/2 z-30 max-w-xl -translate-x-1/2 rounded-card bg-coral/15 px-6 py-4 text-small text-coral">
          {!hasApiKey
            ? "Add a free GROQ_API_KEY to .env (console.groq.com/keys), then restart the server to read chats."
            : `Reading stopped: ${error}`}
        </div>
      )}
    </div>
  );
}
