import { ExternalLink, FileUp, GitBranch, MessageCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { appApi, type Group, type GroupSource } from "@/lib/api";
import { plural } from "@/lib/format";
import { useLive, useLiveQuery } from "@/lib/live";
import { useProjects } from "@/lib/projects";
import { COLORS } from "@/lib/palette";
import { Block, Field, Notice, Row } from "./parts";

const SOURCES: Record<GroupSource, { label: string; color: string }> = {
  simulator: { label: "Simulated", color: COLORS.lilac },
  whatsapp_export: { label: "Imported export", color: COLORS.sky },
  wa_cloud: { label: "WhatsApp Cloud", color: COLORS.mint },
};

/** The open project: its name, WhatsApp groups and GitHub repositories. */
export function ProjectSettings({ onOpenKeys }: { onOpenKeys: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <ProjectName />
      <Groups />
      <Repositories onOpenKeys={onOpenKeys} />
      <ResetBlock />
    </div>
  );
}

function ProjectName() {
  const { current, refresh } = useProjects();
  const [name, setName] = useState(current?.name ?? "");
  const changed = name.trim() && name.trim() !== current?.name;
  return (
    <Block title="Project" description="Each project is its own graph in FalkorDB: its chats, issues, people and code never mix with another project's.">
      <form
        className="flex flex-wrap gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!current || !changed) return;
          await appApi.renameProject(current.id, name);
          await refresh();
        }}
      >
        <Field value={name} onChange={(e) => setName(e.target.value)} className="flex-1" aria-label="Project name" />
        <Button type="submit" variant="secondary" disabled={!changed}>
          Rename
        </Button>
      </form>
      <p className="mt-3 text-small text-faint">Graph: lk_{current?.id}</p>
    </Block>
  );
}

function Groups() {
  const live = useLive();
  const { refresh } = useProjects();
  const { data: groups } = useLiveQuery((api) => api.groups());
  const [name, setName] = useState("");
  const [source, setSource] = useState<GroupSource>("simulator");

  const add = async () => {
    if (!name.trim()) return;
    await live.api.addGroup(name, source);
    setName("");
    live.touch();
    await refresh();
  };

  return (
    <Block
      title="WhatsApp groups"
      description="Where the conversations come from. A simulated group is driven by Go live or the CLI; an imported group is filled from a WhatsApp export."
    >
      {(groups ?? []).length === 0 && <p className="text-body text-muted">No groups yet. Add the first one below.</p>}
      {(groups ?? []).map((group) => (
        <GroupRow key={group.id} group={group} />
      ))}

      <form
        className="mt-6 flex flex-wrap gap-3 border-t border-hairline pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="New group, e.g. Lagos schools" className="min-w-56 flex-1" aria-label="Group name" />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as GroupSource)}
          className="h-12 rounded-pill bg-surface-2 px-5 text-body text-foreground outline-none"
          aria-label="Where messages come from"
        >
          <option value="simulator">Simulated (live)</option>
          <option value="whatsapp_export">From a WhatsApp export</option>
        </select>
        <Button type="submit" disabled={!name.trim()}>
          Add group
        </Button>
      </form>
    </Block>
  );
}

function GroupRow({ group }: { group: Group }) {
  const live = useLive();
  const { refresh } = useProjects();
  const file = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [note, setNote] = useState<string>();
  const source = SOURCES[group.source] ?? SOURCES.whatsapp_export;

  return (
    <Row>
      <MessageCircle className="size-5 shrink-0 text-sky" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await live.api.renameGroup(group.id, name);
              setEditing(false);
              live.touch();
            }}
          >
            <Field value={name} onChange={(e) => setName(e.target.value)} className="flex-1" autoFocus aria-label="Group name" />
            <Button type="submit" size="sm">Save</Button>
          </form>
        ) : (
          <>
            <p className="text-lead font-medium">{group.name}</p>
            <p className="mt-1 text-small text-muted">
              {plural(group.seen, "message")} read, {group.used} used{note && <span className="text-mint">. {note}</span>}
            </p>
          </>
        )}
      </div>
      <Badge color={source.color}>{source.label}</Badge>
      {live.liveGroupId === group.id && live.live && <Badge color={COLORS.mint}>Live now</Badge>}
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" onClick={() => setEditing(!editing)} aria-label={`Rename ${group.name}`}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => file.current?.click()} aria-label={`Import a WhatsApp export into ${group.name}`}>
          <FileUp />
        </Button>
        <Confirm
          title={`Remove "${group.name}"?`}
          description="Loopkeeper stops listening to this group. Issues and promises already learned from it stay."
          action="Remove group"
          onConfirm={async () => {
            await live.api.removeGroup(group.id);
            live.touch();
            await refresh();
          }}
        >
          <Button variant="ghost" size="icon" aria-label={`Remove ${group.name}`}>
            <Trash2 />
          </Button>
        </Confirm>
      </div>
      <input
        ref={file}
        type="file"
        accept=".txt"
        hidden
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          if (!chosen) return;
          const result = await live.api.importExport(group.id, await chosen.text());
          setNote(`Importing ${result.messages} messages`);
        }}
      />
    </Row>
  );
}

function Repositories({ onOpenKeys }: { onOpenKeys: () => void }) {
  const live = useLive();
  const { refresh } = useProjects();
  const { data } = useLiveQuery((api) => api.repos());
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string }>();
  const webhookUrl = `${window.location.origin}/api/github/webhook/${live.project}`;

  const connect = async () => {
    setBusy(true);
    setMessage({ tone: "info", text: "Reading the repository: files, features, code owners and imports…" });
    try {
      const result = await live.api.connectRepo(repo);
      setMessage({ tone: "info", text: `Connected ${result.repo}: ${result.files} files, ${result.features} features (from ${result.featureSource}), ${result.owners} code owners.` });
      setRepo("");
      live.touch();
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Block
      title="GitHub repositories"
      description="Loopkeeper reads the code (never writes it) to link problems to files and owners. It can open GitHub issues, and it notices pull requests and pushes that mention them."
    >
      {data && !data.githubConfigured && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Notice tone="warn">Add a GitHub token first, so Loopkeeper can read repositories.</Notice>
          <Button variant="secondary" size="sm" onClick={onOpenKeys}>
            Add a token
          </Button>
        </div>
      )}
      {data?.lastError && <div className="mb-6"><Notice tone="error">Last sync failed: {data.lastError}</Notice></div>}

      {(data?.repos ?? []).map((r) => (
        <Row key={r.id}>
          <GitBranch className="size-5 shrink-0 text-lilac" />
          <div className="min-w-0 flex-1">
            <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-lead font-medium hover:text-lilac">
              {r.id} <ExternalLink className="size-4" />
            </a>
            <p className="mt-1 text-small text-muted">
              {plural(r.files, "file")}, {plural(r.pullRequests, "pull request")}, {plural(r.commits, "commit")}
              {r.featureSource && `. Features from ${r.featureSource}`}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={async () => (await live.api.syncRepos(), live.touch())} aria-label="Sync now">
              <RefreshCw />
            </Button>
            <Confirm
              title={`Disconnect ${r.id}?`}
              description="Loopkeeper forgets this repository's files. Issues keep their history."
              action="Disconnect"
              onConfirm={async () => {
                await live.api.removeRepo(r.id);
                live.touch();
                await refresh();
              }}
            >
              <Button variant="ghost" size="icon" aria-label={`Disconnect ${r.id}`}>
                <Trash2 />
              </Button>
            </Confirm>
          </div>
        </Row>
      ))}

      <form
        className="mt-6 flex flex-wrap gap-3 border-t border-hairline pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <Field value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or a github.com link" className="min-w-64 flex-1" aria-label="Repository" />
        <Button type="submit" disabled={!repo.trim() || busy || !data?.githubConfigured}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </form>
      {message && <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div>}

      <details className="mt-6 text-small text-muted">
        <summary className="cursor-pointer hover:text-foreground">Instant updates with a webhook</summary>
        <div className="mt-3 space-y-2">
          <p>Without a webhook, Loopkeeper checks GitHub every minute. For instant updates, add a webhook in the repository settings:</p>
          <p>
            URL: <code className="rounded bg-black/40 px-2 py-1 text-foreground">{webhookUrl}</code>
          </p>
          <p>Content type: application/json. Events: pull requests, pushes, issues. Set the same secret in Keys &amp; models.</p>
        </div>
      </details>
    </Block>
  );
}

function ResetBlock() {
  const live = useLive();
  return (
    <Block title="Start over" description="Forget every issue, promise and decision learned so far. Groups, repositories, people and code stay connected.">
      <Confirm title="Forget everything learned?" description="This clears issues, promises, decisions and messages for this project. It can't be undone." action="Forget everything" onConfirm={() => live.reset()}>
        <Button variant="outline">Forget what Loopkeeper learned</Button>
      </Confirm>
    </Block>
  );
}
