import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Page, RailSection } from "@/components/page";
import { Segmented } from "@/components/segmented";
import { AllProjects } from "@/components/settings/all-projects";
import { KeysAndModels } from "@/components/settings/keys";
import { ProjectSettings } from "@/components/settings/project-settings";
import { useProjects } from "@/lib/projects";

type Tab = "project" | "projects" | "keys";

/** Everything you can set while Loopkeeper runs: the open project, all projects, and keys. */
export function SettingsPage() {
  const { current } = useProjects();
  const [tab, setTab] = useState<Tab>("project");

  return (
    <Page
      left={
        <RailSection title="Where this lives">
          <p className="text-small text-muted">
            Projects, groups, repositories and keys are all stored in FalkorDB: one graph per project, plus a small one for app settings. There is no other database.
          </p>
        </RailSection>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="text-headline font-light tracking-tight">Settings</h1>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "project", label: current?.name ?? "This project" },
            { value: "projects", label: "All projects" },
            { value: "keys", label: "Keys & models" },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="mt-12"
        >
          {tab === "project" && <ProjectSettings key={current?.id} onOpenKeys={() => setTab("keys")} />}
          {tab === "projects" && <AllProjects />}
          {tab === "keys" && <KeysAndModels />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}
