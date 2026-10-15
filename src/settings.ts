import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { getFalkorDB } from "./graph/client.js";
import { ensureSchema } from "./graph/schema.js";

/**
 * App-wide settings, edited in the dashboard and stored in FalkorDB itself (a small system graph),
 * so there is no second database. Secrets are encrypted at rest. Values in .env are only a fallback.
 */

const SYSTEM_GRAPH = "loopkeeper";
const SECRET_FIELDS = ["anthropicApiKey", "githubToken", "githubWebhookSecret", "whatsappAccessToken", "whatsappAppSecret", "whatsappVerifyToken"] as const;
const PLAIN_FIELDS = ["fastModel", "smartModel", "anthropicWorkspaceId", "whatsappPhoneNumberId", "whatsappHubGroupId"] as const;

type SecretField = (typeof SECRET_FIELDS)[number];
type PlainField = (typeof PLAIN_FIELDS)[number];
export type SettingField = SecretField | PlainField;

const ENV_FALLBACK: Record<SettingField, () => string> = {
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY ?? "",
  githubToken: () => process.env.GITHUB_TOKEN ?? "",
  githubWebhookSecret: () => process.env.GITHUB_WEBHOOK_SECRET ?? "",
  fastModel: () => config.llm.fastModel,
  smartModel: () => config.llm.smartModel,
  anthropicWorkspaceId: () => process.env.ANTHROPIC_WORKSPACE_ID ?? "",
  whatsappAccessToken: () => process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappAppSecret: () => process.env.WHATSAPP_APP_SECRET ?? "",
  whatsappVerifyToken: () => process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  whatsappPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappHubGroupId: () => process.env.WHATSAPP_HUB_GROUP_ID ?? "",
};

let stored: Partial<Record<SettingField, string>> = {};
const listeners = new Set<() => void>();

/** The current value: what was saved in the app, else .env, else empty. */
export function setting(field: SettingField): string {
  return stored[field] || ENV_FALLBACK[field]();
}

/** Run something whenever settings change (e.g. rebuild an API client with the new key). */
export function onSettingsChange(listener: () => void): void {
  listeners.add(listener);
}

export async function loadSettings(): Promise<void> {
  const graph = (await getFalkorDB()).selectGraph(SYSTEM_GRAPH);
  await ensureSchema(graph);
  const reply = await graph.query<{ s: { properties: Record<string, string> } }>(`MERGE (s:Settings {id: 'app'}) RETURN s`);
  const properties = reply.data?.[0]?.s.properties ?? {};
  stored = {};
  for (const field of PLAIN_FIELDS) if (properties[field]) stored[field] = properties[field];
  // Model names saved for an earlier provider (e.g. Groq) are ignored; Claude models start with "claude".
  for (const field of ["fastModel", "smartModel"] as const) if (!stored[field]?.startsWith("claude")) delete stored[field];
  for (const field of SECRET_FIELDS) if (properties[field]) stored[field] = decrypt(properties[field]);
}

/** Saves the given fields. An empty string clears a field (falling back to .env). */
export async function saveSettings(changes: Partial<Record<SettingField, string>>): Promise<void> {
  const values: Record<string, string | null> = {};
  for (const [field, value] of Object.entries(changes) as Array<[SettingField, string | undefined]>) {
    if (value === undefined || ![...SECRET_FIELDS, ...PLAIN_FIELDS].includes(field)) continue;
    const trimmed = value.trim();
    values[field] = trimmed ? (SECRET_FIELDS.includes(field as SecretField) ? encrypt(trimmed) : trimmed) : null;
  }
  const graph = (await getFalkorDB()).selectGraph(SYSTEM_GRAPH);
  await graph.query(`MERGE (s:Settings {id: 'app'}) SET s += $values`, { params: { values } as never });
  await loadSettings();
  listeners.forEach((listener) => listener());
}

/** What the dashboard may see: whether each secret is set and where from, never the secret itself. */
export function describeSettings() {
  const secret = (field: SecretField) => {
    const value = setting(field);
    return { configured: Boolean(value), source: stored[field] ? "app" : value ? "env" : null, hint: value ? `…${value.slice(-4)}` : null };
  };
  return {
    anthropicApiKey: secret("anthropicApiKey"),
    githubToken: secret("githubToken"),
    githubWebhookSecret: secret("githubWebhookSecret"),
    fastModel: setting("fastModel"),
    smartModel: setting("smartModel"),
    anthropicWorkspaceId: setting("anthropicWorkspaceId"),
    whatsappAccessToken: secret("whatsappAccessToken"),
    whatsappAppSecret: secret("whatsappAppSecret"),
    whatsappVerifyToken: secret("whatsappVerifyToken"),
    whatsappPhoneNumberId: setting("whatsappPhoneNumberId"),
    whatsappHubGroupId: setting("whatsappHubGroupId"),
  };
}

// AES-256-GCM with a key derived from APP_SECRET (falls back to the id salt). Stored as iv.tag.data in base64.
function key(): Buffer {
  return createHash("sha256").update(process.env.APP_SECRET || config.idHashSalt).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(sealed: string): string {
  try {
    const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    console.warn("A saved secret could not be decrypted (APP_SECRET changed?). Re-enter it in Settings.");
    return "";
  }
}
