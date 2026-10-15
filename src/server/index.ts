import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { DEMO_PASSWORD, STAFF } from "../../data/synthetic/staff.js";
import { currentUser, logIn, logOut, requireLogin, requireRole, type StaffUser } from "../auth.js";
import { config } from "../config.js";
import { githubConfigured } from "../github/api.js";
import { getWorld } from "../runtime/world.js";
import { describeSettings, loadSettings, saveSettings, setting, type SettingField } from "../settings.js";
import { clientRoutes } from "./client-routes.js";
import { githubWebhook } from "./github-webhook.js";
import { whatsappWebhook } from "./whatsapp-webhook.js";
import { hqRoutes } from "./hq-routes.js";

type Env = { Variables: { user: StaffUser } };

const app = new Hono();
const api = new Hono<Env>();

// ─── Open routes: login, and GitHub's webhook (which has its own signature check) ───

api.post("/auth/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const user = await logIn(c, email ?? "", password ?? "");
  return user ? c.json(user) : c.json({ error: "That email and password don't match" }, 401);
});

api.post("/auth/logout", (c) => {
  logOut(c);
  return c.json({ ok: true });
});

api.get("/auth/me", (c) => {
  const user = currentUser(c);
  return user ? c.json(user) : c.json({ error: "Not logged in" }, 401);
});

/** The demo accounts, shown on the login screen so judges can try every role. */
api.get("/auth/demo-accounts", (c) =>
  c.json({ password: DEMO_PASSWORD, accounts: STAFF.filter((s) => ["stf_admin", "stf_lead", "stf_ngozi", "stf_tunde"].includes(s.id)).map(({ name, email, role }) => ({ name, email, role })) }),
);

api.route("/github/webhook", githubWebhook);
api.route("/whatsapp/webhook", whatsappWebhook);

// ─── Everything else needs a logged-in staff member ───

api.use("*", requireLogin);

/** What's configured, so the dashboard and CLI can explain what's missing. */
api.get("/status", (c) => c.json({ hasApiKey: Boolean(setting("anthropicApiKey")), githubConfigured: githubConfigured() }));

api.get("/settings", (c) => c.json(describeSettings()));

api.put("/settings", requireRole("admin"), async (c) => {
  await saveSettings(await c.req.json<Partial<Record<SettingField, string>>>());
  return c.json(describeSettings());
});

api.route("/clients/:client", clientRoutes);
api.route("/", hqRoutes);

api.onError((error, c) => {
  console.error(error);
  const status = (error as { status?: number }).status === 404 ? 404 : 500;
  return c.json({ error: error.message }, status);
});

app.route("/api", api);

// In production the built dashboard is served from the same process.
if (existsSync("web/dist")) {
  app.use("/*", serveStatic({ root: "web/dist" }));
}

await loadSettings();
await getWorld();
serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Loopkeeper API on http://localhost:${port}`);
  if (!setting("anthropicApiKey")) console.warn("ℹ No Anthropic API key yet: add one in the dashboard under Settings → Connections");
});
