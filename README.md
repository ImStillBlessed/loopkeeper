# Loopkeeper

**A company brain for teams whose customers live on WhatsApp, not Jira.**

Teachers report bugs, ask questions and make promises in a busy WhatsApp group full of "good morning" and birthday messages. Loopkeeper reads the chat, drops the noise, and turns the rest into a live **FalkorDB graph of work**: who reported what, which school is affected, which feature and code files are involved, who owns them, and what was promised and by when. It answers questions with sources, keeps the knowledge current, and follows the developers' work on GitHub.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB).
Tracks: **03 Company Brain**, **01 Agents That Act on Connected Data**.

## Quick start

Requirements: Node 22+ and Docker. A **free** [Groq API key](https://console.groq.com/keys) to read chats; a GitHub token if you want to connect repositories. Both are added in the app.

```bash
npm install
cp .env.example .env     # infrastructure only (FalkorDB, APP_SECRET)
npm run db:up            # FalkorDB on :6379, FalkorDB Browser on http://localhost:3000
npm run dev              # API on :8787 + dashboard on http://localhost:5173
```

1. Open the dashboard → **Settings → Keys & models** and paste your Groq key (and a GitHub token).
2. Press **Go live**. The demo project's simulated WhatsApp group starts talking: watch the noise get folded away, issues appear, duplicates merge, promises get tracked.
3. Use **⏩** next to the clock to jump a day ahead and watch overdue reminders go out. Then try **Ask**.

### Write into the chat yourself

From the dashboard's **Chat** page (composer at the bottom), or from the terminal:

```bash
npm run chat
```

```text
ednovax › chidi: the timer no dey show for SS2      # speak as anyone
ednovax › issue                                     # a ready-made problem report (also: greet, question, promise, fixed)
ednovax › story S1                                  # play a whole storyline
ednovax › live 2 / pause                            # the group talks on its own, a message every ~2s
ednovax › time +2d                                  # fast-forward the chat clock
ednovax › connect owner/repo · sync · github iss_…  # GitHub
ednovax › help
```

### Projects, groups and repositories

Everything is managed in **Settings** while the app runs:

- **Projects:** create, rename, delete, and switch from the top bar. Each project is its own FalkorDB graph (`lk_<project>`).
- **WhatsApp groups:** add simulated groups, import a WhatsApp export (`Export chat → Without media` → `.txt`) into a group, rename, remove. Live messages arrive on `POST /api/projects/<project>/groups/<group>/messages`, shaped like a WhatsApp webhook.
- **GitHub repositories:** connect `owner/name`. Loopkeeper **reads** the code (never writes it): files, imports, `CODEOWNERS`, and features from `features.yaml` (or folders). It can open GitHub issues with the context from the graph, keeps them in sync, and notices **pull requests and pushes** that mention them (`#12`, `fixes #12`, or a Loopkeeper id). An opened PR marks the issue as being worked on; a merged one marks it as might-be-fixed and asks the school to confirm. Polling every minute works locally; for instant updates add the webhook shown in Settings.

### No second database

Projects, groups, repositories, people, chats, issues, code and the app's own settings all live in FalkorDB: one graph per project plus a small `loopkeeper` graph for settings (keys encrypted with `APP_SECRET`). There is no Postgres; FalkorDB is the only store.

## How it works

```text
WhatsApp group ─▶ inbox (batches messages that arrive together) ─▶ triage (fast model) ─▶ small talk is counted, never stored
                                  │
                                  ▼ work
                    store Message ─▶ pull candidate issues FROM THE GRAPH (same school, vector-nearest, recent)
                                  ─▶ extract (strong model): new issues / updates / promises / decisions
                                  ─▶ write to FalkorDB, every node linked to its source message
                                  ─▶ new issue? vector index → SIMILAR_TO → WCC → judge → DUPLICATE_OF
                                  ─▶ reminders for promises due on the chat's clock

GitHub ─▶ repo index (files, imports, CODEOWNERS, features) ─▶ Feature → CodeFile ← OWNS ← developer
       ─▶ pull requests / pushes / closed issues ─▶ FIXED_BY, REFERENCES, TOUCHES ─▶ status changes + a message back to the group
```

- **The graph shapes the model.** Before extracting, open issues are pulled from FalkorDB and handed to the model, so it says "this is iss_12 again" instead of creating a duplicate.
- **Duplicates** that slip through are caught with the vector index, clustered with **WCC**, and confirmed by a model before merging.
- **Owners** are assigned by walking `Issue → Feature → CodeFile ← OWNS ← Person`.
- **Status changes** are `StatusChange` nodes caused by a message, a person, or a pull request. An unclear "it's working now" only marks issues *possibly resolved* for a human to confirm.
- **The Ask agent** only answers through tools, and every tool is a named Cypher query. Answers come with cited messages, the graph nodes they touched (highlighted on the Globe), and the Cypher used. It can also open a GitHub issue when asked.
- **Priority** on the board is PageRank over the whole graph.
- **Models:** triage `openai/gpt-oss-20b`, extraction and Ask `openai/gpt-oss-120b` on Groq; embeddings `all-MiniLM-L6-v2` run locally (384-dim, matching the vector index). Changeable in Settings.

All Cypher lives in [`src/graph/queries.ts`](src/graph/queries.ts), each query with an id (`Q…` reads, `W…` writes, `C…` context, `P…` projects, `IX…` repo index, `GH…` GitHub, `M…` management).

Other commands:

```bash
npm test                 # parser, simulator, GitHub linking, and the full pipeline against FalkorDB (fake LLM, no key needed)
npm run db:check         # smoke test: indexes, vector search, WCC, PageRank, shortest path
npm run data:generate    # writes the synthetic chat to data/synthetic/output/
npm run build && npm start   # production: one process serves the API and the built dashboard
```

> On Windows, use `FALKORDB_HOST=127.0.0.1` rather than `localhost`, which can resolve to another Redis (e.g. inside WSL).

## Project layout

```text
src/
  graph/      FalkorDB client (one graph per project), schema, seed, all named queries
  ingest/     WhatsApp export parser, live messages, id hashing
  llm/        Groq client (OpenAI-compatible), local embeddings, reply cache, prompt loader
  pipeline/   triage → extract → apply (issues, duplicates, status, promises, decisions) → reminders
  agent/      ask agent: tools (= Cypher queries) and the tool-calling loop
  github/     repo indexer, issues, pull request / push / issue activity
  runtime/    per-project live state: inbox, chat clock, simulator, event hub
  server/     Hono API, live event stream, GitHub webhook
  settings.ts app settings stored in FalkorDB (secrets encrypted)
cli/          npm run chat: write into the group and control the live chat
web/          Vite + React dashboard (Tailwind, shadcn components, motion, 3D globe)
prompts/      the prompts, as Markdown
data/synthetic/  fictional cast, storylines, prepared messages, product catalog
tests/        parser, simulator, GitHub linking, full pipeline against FalkorDB
```

## Data

All data is fictional. See [data/README.md](data/README.md).
