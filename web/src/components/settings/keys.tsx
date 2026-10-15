import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appApi, type SecretSetting, type Settings } from "@/lib/api";
import { useProjects } from "@/lib/projects";
import { COLORS } from "@/lib/palette";
import { Block, Field, Row } from "./parts";

type SecretField = "groqApiKey" | "githubToken" | "githubWebhookSecret";

const SECRETS: Array<{ field: SecretField; label: string; help: string; link?: { href: string; text: string } }> = [
  {
    field: "groqApiKey",
    label: "Groq API key",
    help: "Reads the chat and answers questions. The free tier is enough for a demo.",
    link: { href: "https://console.groq.com/keys", text: "Get a free key" },
  },
  {
    field: "githubToken",
    label: "GitHub token",
    help: "A fine-grained token with Contents: read, Pull requests: read, Issues: read and write. Loopkeeper never writes code.",
    link: { href: "https://github.com/settings/personal-access-tokens/new", text: "Create a token" },
  },
  {
    field: "githubWebhookSecret",
    label: "GitHub webhook secret",
    help: "Optional. If set, webhook deliveries without the matching signature are rejected.",
  },
];

/** Keys and models for the whole app. Stored in FalkorDB, encrypted; never shown again after saving. */
export function KeysAndModels() {
  const { refresh } = useProjects();
  const [settings, setSettings] = useState<Settings>();

  useEffect(() => {
    void appApi.settings().then(setSettings);
  }, []);

  const save = async (changes: Parameters<typeof appApi.saveSettings>[0]) => {
    setSettings(await appApi.saveSettings(changes));
    await refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Block title="Keys" description="Saved in Loopkeeper's own FalkorDB graph and encrypted. Anything saved here takes effect immediately, no restart.">
        {SECRETS.map((secret) => (
          <SecretRow key={secret.field} {...secret} value={settings?.[secret.field]} onSave={(value) => save({ [secret.field]: value })} />
        ))}
      </Block>

      <Block title="Models" description="Any model your Groq account can use. The fast one triages every message; the strong one extracts issues and answers questions.">
        {settings && <Models settings={settings} onSave={save} />}
      </Block>
    </div>
  );
}

function SecretRow({ label, help, link, value, onSave }: (typeof SECRETS)[number] & { value: SecretSetting | undefined; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const status = !value?.configured
    ? { text: "Not set", color: COLORS.muted }
    : value.source === "app"
      ? { text: `Saved ${value.hint}`, color: COLORS.mint }
      : { text: `From .env ${value.hint}`, color: COLORS.sky };

  const submit = async (next: string) => {
    setSaving(true);
    try {
      await onSave(next);
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Row className="items-start">
      <KeyRound className="mt-1 size-5 shrink-0 text-sunflower" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-lead font-medium">{label}</p>
          <Badge color={status.color}>{status.text}</Badge>
        </div>
        <p className="mt-1 max-w-xl text-small text-muted">
          {help}{" "}
          {link && (
            <a href={link.href} target="_blank" rel="noreferrer" className="text-lilac hover:underline">
              {link.text}
            </a>
          )}
        </p>
        <form
          className="mt-4 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void submit(draft);
          }}
        >
          <Field type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={value?.configured ? "Paste a new value to replace it" : "Paste it here"} className="min-w-64 flex-1" aria-label={label} />
          <Button type="submit" variant="secondary" disabled={!draft.trim() || saving}>
            Save
          </Button>
          {value?.source === "app" && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void submit("")}>
              Remove
            </Button>
          )}
        </form>
      </div>
    </Row>
  );
}

function Models({ settings, onSave }: { settings: Settings; onSave: (changes: { fastModel?: string; smartModel?: string }) => Promise<void> }) {
  const [fast, setFast] = useState(settings.fastModel);
  const [smart, setSmart] = useState(settings.smartModel);
  const changed = fast !== settings.fastModel || smart !== settings.smartModel;
  return (
    <form
      className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ fastModel: fast, smartModel: smart });
      }}
    >
      <label className="flex flex-col gap-2 text-small text-muted">
        Fast (triage)
        <Field value={fast} onChange={(e) => setFast(e.target.value)} />
      </label>
      <label className="flex flex-col gap-2 text-small text-muted">
        Strong (extraction and Ask)
        <Field value={smart} onChange={(e) => setSmart(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary" disabled={!changed}>
        Save models
      </Button>
    </form>
  );
}
