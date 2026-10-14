# Loopkeeper

**A company brain for teams whose customers live on WhatsApp, not Jira.**

Teachers report bugs, ask questions and make promises in a busy WhatsApp group full of "good morning" and birthday messages. Loopkeeper reads the chat, drops the noise, and turns the rest into a live **FalkorDB graph of work**: who reported what, which school is affected, which feature and code files are involved, who owns them, and what was promised and by when. It answers questions with sources and keeps the knowledge current.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs × FalkorDB).
Tracks: **03 Company Brain**, **01 Agents That Act on Connected Data**.

> 🚧 Work in progress during the hackathon (14–18 Oct 2026).

## Quick start

Requirements: Node 22+, Docker.

```bash
npm install
cp .env.example .env
npm run db:up            # FalkorDB on :6379, FalkorDB Browser on http://localhost:3000
npm run db:check         # smoke test: indexes, vector search, WCC, PageRank, shortest path
npm run data:generate    # writes the synthetic WhatsApp chat to data/synthetic/output/
npm test
```

## Project layout

```
src/
  graph/      FalkorDB client (one graph per tenant) and schema/indexes
  ingest/     WhatsApp export parser, id hashing
  pipeline/   triage → extract → resolve → status (in progress)
data/synthetic/  fictional chat generator + ground-truth labels
scripts/    one-off tools (FalkorDB smoke test)
tests/      parser and synthetic data tests
docs/       DECISIONS.md (why), AI_USAGE.md (disclosure)
```

## Data

All data is fictional. See [data/README.md](data/README.md).
