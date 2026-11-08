# Decision Memory

**Your team already decided. Decision Memory makes sure nobody forgets.**

A Forge app for Jira + Rovo that captures team decisions where they happen (Jira comments, the issue panel, Rovo chat, any MCP client), and **flags new work that contradicts them** with the evidence, the reasoning and the person who owns the decision.

| Surface | What it does |
|---|---|
| **Automatic capture** | Write `Decision: …` in a Jira comment, or use the native `/decision` block, and it's recorded with owner, source link and guardrails. |
| **Conflict alerts** | When an issue is created or its summary/description changes, it is checked against every active decision. Conflicts get **one** explanatory comment and a `decision-conflict` label. |
| **Issue panel** | Conflicts with evidence, decisions this issue *implements*, related decisions, acknowledge/dismiss, and "record a decision" with a live guardrail preview. |
| **Decision Log** (Jira global page) | Searchable log with stats, detail view (rationale, owner's teams via Teamwork Graph, lineage), supersede/revoke, and "Check a proposal" for PR/RFC text. |
| **Rovo agent** | "Why do we use Postgres?", "Does this issue conflict with anything?", "Record the decisions on this Confluence page". |
| **Rovo actions** | `search-decisions`, `get-decision`, `check-conflicts`, `record-decision`, `supersede-decision`, `list-due-for-review` are reusable tools other agents can call. |
| **MCP server** (`rovo:mcp`) | The same tools in Claude Code, Cursor, VS Code: "check my plan against team decisions before I code". |
| **Teamwork Graph connector** | Publishes every site-wide decision into the Teamwork Graph as a document linked to its Jira issue, and reads the owner's teams back, so Rovo search and other agents can find decisions and see who stands behind them. |
| **Confluence** | Page ⋯ → *Capture decisions* turns decision blocks, "Decision:" lines and ADR pages into decisions. A *Decision Log* macro embeds them on any page. Same installation and database as Jira. |
| **ADR import** | Paste Markdown ADRs (Nygard or MADR); superseded ADRs are imported as history. |
| **Insights** | Conflicts caught per month, alert precision, most-protective decisions, and hygiene (missing rationale or guardrails, overdue reviews). |
| **Admin settings** | Auto-comment on or off, minimum confidence, label, comment drift checks, review reminders, and dismissal quieting. |
| **Learning loop** | Decisions whose alerts keep being dismissed are quieted to high confidence only and flagged for guardrail tuning. |
| **Review reminders** | A daily job reminds owners on the source issue when a decision passes its review date. |

## How it works

```
Jira comment / panel / Rovo / MCP ──► record ──► Forge SQL (decisions + guardrails)
                                                     │
Issue created/updated ──► conflict engine ◄──────────┘
   (trigger)              BM25 relevance + guardrail matching + intent detection
                              │
               ┌──────────────┼───────────────────────┐
         Jira comment     Issue panel         Rovo / MCP answer
         + label          (ack / dismiss)     (cites DEC-n + evidence)
```

**Conflict engine (`src/lib/conflicts.js`).** Each decision is stored with *guardrails*: things to **avoid** and to **prefer**. They're extracted from the statement ("Use PostgreSQL **instead of** MongoDB" gives prefer `postgresql`, avoid `mongodb`), shown live while you type, and can be edited.

New work is checked like this:

1. **Guardrail hit + intent.** "Add a MongoDB cluster" is a **conflict**. "Migrate off MongoDB" moves away from the avoided term, so it's **aligned** (it *implements* the decision).
2. **BM25 ranking** across title, statement, rationale and tags finds **related** decisions and raises conflict confidence.
3. Every finding includes the matched term and a text snippet, so it's explainable and never a black box.

The engine is deterministic and runs inside the Forge function. It needs no paid LLM, vector database or external service, so automatic checks cost nothing beyond the Forge free allowance. Rovo adds natural-language reasoning on top.

## Security and privacy

- **Visibility model.** A decision captured from a comment is scoped to its project, and only users who can browse that project see it in search, the Decision Log, Rovo or MCP. Decisions recorded through the panel, Rovo or MCP are site-wide by default, with an opt-in project-only scope.
- **Restricted content is never captured.** Comments with role or group visibility, and issues behind a security level, are skipped.
- **Every user-facing read runs as the user.** `asUser()` makes Jira enforce permissions. App-authored comments only reference decisions that are site-wide or from the same project.
- **Authorisation never trusts inputs.** The account ID comes from the platform context. Only the owner or a Jira admin can supersede or revoke a decision.
- **Input validation.** Lengths are capped, links must be https, dates are strict, and all SQL uses prepared statements.
- **No loops.** Triggers use `ignoreSelf`, ignore comments written by apps, and a unique `(issue, decision)` key means one alert per issue per decision.
- **Fail-safe integrations.** Teamwork Graph and reminder failures are logged and never break the core flow.
- **No egress.** The app makes no external network calls, has no remote backend, and needs no secrets.

## Cost: $0

Everything runs on Forge-hosted compute and Forge SQL, well inside the free monthly allowances (200k GB-s compute, 1 SQL compute-hour, 1 GB logs). Rovo credits are not billed to the developer. The function memory is set to 256 MB to stretch the allowance further.

## Setup

Requirements: Node 22+, a free Atlassian developer site with Rovo enabled (<http://go.atlassian.com/cloud-dev>).

```bash
npm install -g @forge/cli
forge login                    # uses an Atlassian API token
forge register                 # writes your app id into manifest.yml
npm install
npm test                       # 45 unit tests for the engine
forge lint
forge deploy -e development
forge install -e development --product jira --site <your-site>.atlassian.net
forge install -e development --product confluence --site <your-site>.atlassian.net   # same installation, shared data
```

Diagram: `docs/architecture.svg`. MCP: `docs/MCP.md`. Marketplace: `docs/MARKETPLACE.md`. Privacy: `docs/PRIVACY.md`.

**MCP clients (optional).** An admin enables the app's tools under *Atlassian Administration → Apps → Sites → Connected apps*. Then:

```bash
claude mcp add --transport http decision-memory https://mcp.atlassian.com/forge/<app-uuid>
```

**Teamwork Graph.** An admin connects the connector under *Atlassian Administration → Apps → Sites → Connected apps → Decision Memory → Connections*. All site-wide decisions are then backfilled and kept in sync. Reading an owner's teams uses the Teamwork Graph API (Preview), which may require Atlassian to allowlist the app. Until then that field shows *not available*.

## Project layout

```
manifest.yml                 modules: rovo:agent, rovo:mcp, action×6, issuePanel, globalPage, triggers, sql
prompts/agent.md             Rovo agent instructions
src/lib/                     pure logic (unit tested): text, bm25, guardrails, conflicts, adf, validate
src/db/                      Forge SQL schema + repositories
src/services/                business rules, Jira, permissions/visibility, Teamwork Graph
src/handlers/                thin adapters: Rovo/MCP actions, UI resolvers, triggers
src/frontend/                UI Kit: issue panel, Decision Log
test/                        node:test suites
docs/                        submission text + demo script
```
