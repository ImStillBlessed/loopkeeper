# Loopkeeper

**A company brain for teams whose customers live on WhatsApp, not Jira.**

Teachers report bugs, ask questions and make promises in a busy WhatsApp group full of "good morning" and birthday messages. Loopkeeper reads the chat, drops the noise, and turns the rest into a live **FalkorDB graph of work**: who reported what, which school is affected, which feature and code files are involved, who owns them, and what was promised and by when. It answers questions with sources and keeps the knowledge current.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB).
Tracks: **03 Company Brain**, **01 Agents That Act on Connected Data**.

## Quick start

Requirements: Node 22+, Docker, and a **free** [Groq API key](https://console.groq.com/keys). Embeddings run locally, so no other key is needed.

```bash
npm install
cp .env.example .env     # then set GROQ_API_KEY
npm run db:up            # FalkorDB on :6379, FalkorDB Browser on http://localhost:3000
npm run dev              # API on :8787 + dashboard on http://localhost:5173
```

Open the dashboard and press **▶ Replay chat**. The first replay takes a few minutes on Groq's free tier (rate limits; the client waits and retries). Model replies are cached in `.cache/`, so later replays of the same chat are instant and use no quota.

 Three weeks of a (fictional) school support group stream in; watch the noise get ignored, issues appear on the board, duplicates merge, promises get tracked and reminders go out. Then try the **Ask** tab.

You can also import a real WhatsApp export (`Export chat → Without media` → `.txt`) with **Import .txt**.

Other commands:

```bash
npm test                 # parser, synthetic data, and the full pipeline against FalkorDB (fake LLM, no key needed)
npm run db:check         # smoke test: indexes, vector search, WCC, PageRank, shortest path
npm run data:generate    # writes the synthetic chat to data/synthetic/output/
npm run build && npm start   # production: one process serves the API and the built dashboard
```

> On Windows, use `FALKORDB_HOST=127.0.0.1` rather than `localhost`, which can resolve to another Redis (e.g. inside WSL).

## How it works

```text
WhatsApp export ─▶ parse ─▶ triage (fast model, batches of 20) ─▶ noise is counted, never stored
                                  │
                                  ▼ work
                    store Message ─▶ pull candidate issues FROM THE GRAPH (same school, vector-nearest, recent)
                                  ─▶ extract (strong model): new issues / updates / promises / decisions
                                  ─▶ write to FalkorDB, every node linked to its source message
                                  ─▶ new issue? vector index → SIMILAR_TO → WCC → judge → DUPLICATE_OF
                                  ─▶ reminders for promises due on the chat's clock
```

- **The graph shapes the model.** Before extracting, open issues are pulled from FalkorDB and handed to the model, so it says "this is iss_12 again" instead of creating a duplicate.
- **Duplicates** that slip through are caught with the vector index, clustered with **WCC**, and confirmed by a model before merging.
- **Models:** triage uses `openai/gpt-oss-20b`, extraction and Ask use `openai/gpt-oss-120b` on Groq; embeddings are `all-MiniLM-L6-v2` run locally (384-dim, matching the FalkorDB vector index). All configurable in `.env`.
- **Owners** are assigned by walking `Issue → Feature → CodeFile ← OWNS ← Person`.
- **Status changes** are `StatusChange` nodes caused by a message. An unclear "it's working now" only marks issues *possibly resolved* for a human to confirm.
- **The Ask agent** only answers through tools, and every tool is a named Cypher query. Answers come with cited messages, the graph nodes they touched (highlighted in the Graph tab), and the Cypher used.
- **Priority** on the board is PageRank over the whole graph.

All Cypher lives in [`src/graph/queries.ts`](src/graph/queries.ts), each query with an id (`Q1`…, `W1`…, `C1`…, `S1`…).

## Project layout

```text
src/
  graph/      FalkorDB client (one graph per tenant), schema, seed, all named queries
  ingest/     WhatsApp export parser, id hashing
  llm/        Groq client (OpenAI-compatible), local embeddings, reply cache, prompt loader
  pipeline/   triage → extract → apply (issues, duplicates, status, promises, decisions) → reminders
  agent/      ask agent: tools (= Cypher queries) and the tool-calling loop
  server/     Hono API + live event stream
web/          Vite + React dashboard (Tailwind, shadcn components, motion, 3D globe): Today, Chat, Issues, Globe, Ask
prompts/      the prompts, as Markdown
data/synthetic/  fictional chat generator, product catalog, ground-truth labels
tests/        parser, synthetic data, full pipeline against FalkorDB
```

## Data

All data is fictional. See [data/README.md](data/README.md).
