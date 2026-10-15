import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { githubConfigured } from "../github/api.js";
import { listProjectIds } from "../graph/client.js";
import { createProject, deleteProject, listProjects, prepareProjects, renameProject, type GroupSource } from "../runtime/projects.js";
import { describeSettings, loadSettings, saveSettings, setting, type SettingField } from "../settings.js";
import { githubWebhook } from "./github-webhook.js";
import { projectRoutes } from "./project-routes.js";

const app = new Hono();
const api = new Hono();

/** What's configured, so the dashboard and CLI can explain what's missing. */
api.get("/status", (c) =>
  c.json({ hasApiKey: Boolean(setting("groqApiKey")), githubConfigured: githubConfigured(), defaultProject: config.defaultProject }),
);

// ─── App settings (stored in FalkorDB, secrets encrypted) ───────────────────

api.get("/settings", (c) => c.json(describeSettings()));

api.put("/settings", async (c) => {
  await saveSettings(await c.req.json<Partial<Record<SettingField, string>>>());
  return c.json(describeSettings());
});

// ─── Projects ────────────────────────────────────────────────────────────────

api.get("/projects", async (c) => c.json(await listProjects()));

api.post("/projects", async (c) => {
  const { name, firstGroup } = await c.req.json<{ name: string; firstGroup?: { name: string; source: GroupSource } }>();
  return c.json(await createProject(name ?? "", firstGroup));
});

api.patch("/projects/:project", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  await renameProject(c.req.param("project"), name ?? "");
  return c.json({ ok: true });
});

api.delete("/projects/:project", async (c) => {
  const id = c.req.param("project");
  if (!(await listProjectIds()).includes(id)) return c.json({ error: `No project "${id}"` }, 404);
  await deleteProject(id);
  return c.json({ ok: true });
});

api.route("/projects/:project", projectRoutes);
api.route("/github/webhook", githubWebhook);

api.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message }, 500);
});

app.route("/api", api);

// In production the built dashboard is served from the same process.
if (existsSync("web/dist")) {
  app.use("/*", serveStatic({ root: "web/dist" }));
}

await loadSettings();
await prepareProjects();
serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Loopkeeper API on http://localhost:${port}`);
  if (!setting("groqApiKey")) console.warn("ℹ No Groq API key yet: add one in the dashboard under Settings (free at console.groq.com/keys)");
});
