import { Check, FolderGit2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { appApi } from "@/lib/api";
import { plural } from "@/lib/format";
import { useProjects } from "@/lib/projects";
import { Block, Field, Notice, Row } from "./parts";

/** Every project: open one, create one, delete one. */
export function AllProjects() {
  const { projects, current, switchTo, refresh } = useProjects();
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("Support group");
  const [error, setError] = useState<string>();

  const create = async () => {
    setError(undefined);
    try {
      const project = await appApi.createProject(name, groupName.trim() ? { name: groupName, source: "simulator" } : undefined);
      setName("");
      await refresh();
      switchTo(project.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Block title="Projects" description="One project per client or product. Each keeps its own WhatsApp groups, repositories and graph.">
        {projects.map((project) => (
          <Row key={project.id}>
            <FolderGit2 className="size-5 shrink-0 text-lilac" />
            <div className="min-w-0 flex-1">
              <p className="text-lead font-medium">{project.name}</p>
              <p className="mt-1 text-small text-muted">
                {plural(project.groups, "group")}, {plural(project.repos, "repo")}, {plural(project.seen, "message")} read
              </p>
            </div>
            {project.id === current?.id ? (
              <span className="flex items-center gap-2 text-small text-mint">
                <Check className="size-4" /> Open
              </span>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => switchTo(project.id)}>
                Open
              </Button>
            )}
            <Confirm
              title={`Delete ${project.name}?`}
              description={
                <>
                  This deletes the project&apos;s whole graph (<code>lk_{project.id}</code>): its groups, issues, promises and code links. It can&apos;t be undone.
                </>
              }
              action="Delete project"
              onConfirm={async () => {
                await appApi.deleteProject(project.id);
                await refresh();
              }}
            >
              <Button variant="ghost" size="icon" disabled={projects.length === 1} aria-label={`Delete ${project.name}`}>
                <Trash2 />
              </Button>
            </Confirm>
          </Row>
        ))}
      </Block>

      <Block title="New project" description="Starts empty, with one simulated WhatsApp group so you can try it straight away. Connect a repository afterwards.">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name, e.g. Ednovax Ghana" className="min-w-60 flex-1" aria-label="Project name" />
          <Field value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="First group" className="min-w-48" aria-label="First group name" />
          <Button type="submit" disabled={!name.trim()}>
            Create project
          </Button>
        </form>
        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
      </Block>
    </div>
  );
}
