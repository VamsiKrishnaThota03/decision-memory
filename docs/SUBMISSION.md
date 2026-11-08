# Devpost submission: Decision Memory

**Category:** Apps for Software Teams
**Bonus prizes:** Best Rovo Agent · Best app with Atlassian MCP · Best Teamwork Graph integration (· Best Marketplace app, if listed)

## Tagline
Your team already decided. Decision Memory makes sure nobody forgets, and warns you before new work quietly contradicts it.

## Inspiration
Every team has decisions that live only in someone's head or in a comment thread from eight months ago: "we chose Postgres over Mongo", "no Friday deploys", "the v1 API is deprecated". New joiners don't know them, and veterans forget. The cost shows up late: a sprint spent on a direction the team already rejected, a review fight that re-argues a settled question, or an incident caused by breaking a rule nobody could find. Atlassian calls the Teamwork Graph the organisation's associative memory. Decision Memory turns one of its most valuable kinds of knowledge, *decisions*, into something that actively protects your work.

## What it does
- **Captures decisions where they already happen.** Write `Decision: …` or use the native `/decision` block in a Jira comment, record one in the issue panel, or ask the Rovo agent to pull decisions out of a Confluence page or meeting notes.
- **Guardrails you can see.** Each decision is turned into checkable *avoid* and *prefer* terms, shown live as you type and editable.
- **Proactive conflict detection.** When an issue is created or re-scoped, it's checked against every active decision. A conflict gets one clear Jira comment: which decision, the evidence snippet, why it was decided, and who owns it, with two ways forward (align the work or supersede the decision).
- **Understands intent.** "Add MongoDB" is a conflict. "Migrate off MongoDB" *implements* the decision.
- **Decision lifecycle.** Supersede (with lineage), revoke (with reason), review dates and a "due for review" list, so decisions don't go stale.
- **Everywhere you work.**
  - Jira: issue panel, Decision Log, admin settings.
  - Confluence: page action and macro, in the same installation as Jira.
  - Rovo chat, plus reusable actions that other agents can call.
  - IDE assistants through MCP, which can check a `git diff` before the PR is opened.
- **Teamwork Graph, both directions.** Decisions are published into the graph as documents linked to their issues, and owners' teams are read back.
- **Gets smarter and stays fresh.** Tech aliases (pg = Postgres), dismissal learning, review reminders, ADR import, and an insights dashboard with conflicts caught and alert precision.

## How we built it
- **Forge** (Node 22 runtime), **UI Kit** for the native Jira UI, **Forge SQL** for storage.
- **Rovo:** a `rovo:agent` with six `action` modules. The actions are reusable tools that other agents can call too.
- **MCP:** a `rovo:mcp` module exposes the same tools to Claude Code, Cursor and other MCP clients.
- **Teamwork Graph:** a Cypher query via `requestTeamworkGraph` resolves each decision owner's teams, so ownership survives people moving on.
- **Jira platform:** triggers (`created`, `updated`, `commented`, lifecycle), ADF parsing of native decision blocks, ADF comment rendering, and project-permission checks.
- **The conflict engine** is deterministic and explainable: BM25 ranking, guardrail extraction from natural-language decisions, phrase matching with intent detection, and evidence snippets. It runs inside the Forge function with zero paid AI calls, so it's cheap enough to check every single issue. Rovo adds conversational reasoning on top.

## Challenges
- **Explainability over magic.** Automatic comments on people's issues must be right and must say why. We designed the guardrail and intent model so every alert quotes its evidence.
- **Permissions.** Decisions captured from restricted projects must never leak, whether through search, Rovo or MCP. We built a project-scoped visibility model and enforce it in one service layer.
- **No noise.** One alert per issue per decision, `ignoreSelf` triggers, bot-comment filtering, and acknowledge/dismiss state.

## Accomplishments
- One business-logic layer serves five surfaces: Jira UI, triggers, Rovo, other agents, and MCP.
- The engine has unit tests (45) covering capture, guardrails, intent, scoring and validation.
- Running it costs $0.

## What's next
- A companion Bitbucket app with merge checks. Forge doesn't allow workspace and site scopes in one app, so today PR diffs are checked through MCP and Rovo.
- Richer graph relationships, such as decision → team → repository.
- Per-project policies (for example, "required" decisions that block transitions).

## Testing instructions for judges
0. Fastest path: open **Apps → Decision Log** and click **Load 5 sample decisions**, then jump to step 4.
1. Open the installation link: `<PASTE forge install link>` and install the app on your Jira site with Rovo enabled.
2. In any project, create issue **A** and comment:
   `Decision: Use PostgreSQL instead of MongoDB for all new services.`
   A green confirmation comment appears with `DEC-1`.
3. Use the issue panel to record a site-wide decision: `Do not deploy to production on Fridays.`
4. Create issue **B** with summary `Add MongoDB cluster for recommendations service`. Within seconds a warning comment and the `decision-conflict` label appear, and the panel shows the conflict with evidence.
5. Create issue **C**: `Migrate orders service off MongoDB`. The panel shows it **implements** DEC-1, with no conflict.
6. In Rovo chat, pick the **Decision Memory** agent and ask: *"Why do we use PostgreSQL?"* or, on issue B, *"Does this issue conflict with any decisions?"*
7. Open **Apps → Decision Log**: search, open a decision, supersede it, and try **Check a proposal** with PR text.
8. In Confluence, open any page with a decision block, then ⋯ → **Capture decisions (Decision Memory)**.
9. (MCP) `claude mcp add --transport http decision-memory https://mcp.atlassian.com/forge/<app-uuid>` and ask your IDE assistant to check a plan against team decisions.
