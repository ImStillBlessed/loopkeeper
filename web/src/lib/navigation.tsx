import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const PAGES = ["today", "chat", "issues", "globe", "ask"] as const;
export type Page = (typeof PAGES)[number];

interface Navigation {
  page: Page;
  go: (page: Page) => void;
  /** Node ids to light up on the globe (from an answer or an issue). */
  highlight: string[];
  showOnGlobe: (nodeIds: string[]) => void;
  /** The issue whose sheet is open, if any. */
  openIssueId: string | undefined;
  openIssue: (issueId: string | undefined) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

const pageFromHash = (): Page => {
  const hash = window.location.hash.replace("#/", "") as Page;
  return PAGES.includes(hash) ? hash : "today";
};

/** One page at a time, kept in the URL hash so a refresh stays put. */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [openIssueId, openIssue] = useState<string>();

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const go = useCallback((next: Page) => {
    window.location.hash = `/${next}`;
  }, []);

  const showOnGlobe = useCallback(
    (nodeIds: string[]) => {
      setHighlight(nodeIds);
      openIssue(undefined);
      go("globe");
    },
    [go],
  );

  return (
    <NavigationContext.Provider value={{ page, go, highlight, showOnGlobe, openIssueId, openIssue }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return navigation;
}
