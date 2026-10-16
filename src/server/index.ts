import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { STAFF } from "../../data/demo/staff.js";
import { currentUser, logIn, logOut, requireLogin, requireRole, type StaffUser } from "../auth.js";
import { config } from "../config.js";
import { githubConfigured } from "../github/api.js";
import { getWorld } from "../runtime/world.js";
import { describeSettings, loadSettings, saveSettings, setting, type SettingField } from "../settings.js";
import { clientRoutes } from "./client-routes.js";
import { dbRoutes } from "./db-routes.js";
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

api.get("/auth/me", async (c) => {
  const user = await currentUser(c);
  return user ? c.json(user) : c.json({ error: "Not logged in" }, 401);
});

/** The demo accounts, shown on the login screen so judges can sign in (unless turned off with SHOW_DEMO_ACCOUNTS=false). */
api.get("/auth/demo-accounts", (c) =>
  c.json(config.demo.showAccounts ? { password: config.demo.password, accounts: STAFF.map(({ name, email, role, title }) => ({ name, email, role, title })) } : { password: null, accounts: [] }),
);

api.route("/github/webhook", githubWebhook);
api.route("/whatsapp/webhook", whatsappWebhook);

// ─── Everything else needs a logged-in staff member ───

api.use("*", requireLogin);

/** What's configured, so the dashboard and CLI can explain what's missing, and where the desk is reachable. */
api.get("/status", (c) => c.json({ hasApiKey: Boolean(setting("anthropicApiKey")), githubConfigured: githubConfigured(), publicUrl: publicUrl(c) }));

api.get("/settings", (c) => c.json(describeSettings()));

api.put("/settings", requireRole("admin"), async (c) => {
  await saveSettings(await c.req.json<Partial<Record<SettingField, string>>>());
  return c.json(describeSettings());
});

api.route("/clients/:client", clientRoutes);
api.route("/db", dbRoutes);
api.route("/", hqRoutes);

api.onError((error, c) => {
  console.error(error);
  const status = (error as { status?: number }).status === 404 ? 404 : 500;
  return c.json({ error: error.message }, status);
});

app.route("/api", api);

/** PUBLIC_URL from .env, or else the address this request came in on (through a proxy or tunnel too). */
function publicUrl(c: { req: { header: (name: string) => string | undefined; url: string } }): string {
  if (config.publicUrl) return config.publicUrl;
  const host = (c.req.header("x-forwarded-host") ?? c.req.header("host"))?.split(",")[0].trim();
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0] ?? new URL(c.req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(c.req.url).origin;
}

// In production the built dashboard is served from the same process.
if (existsSync("web/dist")) {
  app.use("/*", serveStatic({ root: "web/dist" }));
}

await loadSettings();
await getWorld();
serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
  console.log(`Loopkeeper API on http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${port}`);
  if (!setting("anthropicApiKey")) console.warn("ℹ No Anthropic API key yet: add one in the dashboard under Settings → Connections");
});
