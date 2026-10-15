import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { appApi, type AppStatus, type Project } from "./api";

interface ProjectsState {
  projects: Project[];
  /** The project everything on screen is about. */
  current: Project | undefined;
  status: AppStatus | undefined;
  switchTo: (id: string) => void;
  refresh: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsState | null>(null);
const STORAGE_KEY = "loopkeeper.project";

function remembered(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The list of projects (each one a FalkorDB graph) and which one is open. */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<AppStatus>();
  const [currentId, setCurrentId] = useState<string | undefined>(remembered);

  const refresh = useCallback(async () => {
    const [list, appStatus] = await Promise.all([appApi.projects(), appApi.status()]);
    setProjects(list);
    setStatus(appStatus);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }, []);

  const current = projects.find((p) => p.id === currentId) ?? projects.find((p) => p.id === status?.defaultProject) ?? projects[0];

  return <ProjectsContext.Provider value={{ projects, current, status, switchTo, refresh }}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsState {
  const state = useContext(ProjectsContext);
  if (!state) throw new Error("useProjects must be used inside <ProjectsProvider>");
  return state;
}
