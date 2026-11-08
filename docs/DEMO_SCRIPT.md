# Demo video script (target 4:00, hard limit under 5:00)

Record at 1080p on a clean developer site. Seed the data first (see bottom). Upload to YouTube as **Public**.

| Time | Scene | Say |
|---|---|---|
| 0:00–0:25 | Slide: "8 months ago your team decided X. Today someone builds not-X." | "Teams lose decisions. Then they re-argue them, or worse, quietly break them. Decision Memory gives your team a memory that speaks up." |
| 0:25–0:55 | Jira issue → comment `Decision: Use PostgreSQL instead of MongoDB for all new services.` → green capture comment | "No new process. Write a decision where you already talk, and it's captured with an owner, a source and guardrails." |
| 0:55–1:20 | Issue panel → Record a decision → type "Do not deploy to production on Fridays", show live guardrail tags | "Every decision becomes checkable. You see exactly what we'll watch for." |
| 1:20–2:05 | Create issue "Add MongoDB cluster for recommendations service" → refresh → warning comment + label + panel conflict card with evidence, owner, Acknowledge | "New work that contradicts a decision gets flagged instantly, with evidence, the reasoning, and who to talk to. Align, or supersede. Never silently ignore." |
| 2:05–2:25 | Create "Migrate orders off MongoDB" → panel shows **Implements DEC-1** | "It understands intent: moving away from Mongo implements the decision." |
| 2:25–3:05 | Rovo chat → Decision Memory agent: "Why do we use Postgres?", then on a Confluence page: "Record the decisions on this page" → confirm → recorded | "In Rovo it answers why, with citations, and turns meeting notes into decisions." |
| 3:05–3:30 | Claude Code / Cursor with MCP: "Before I start, check my plan: add Mongo for caching" → conflict returned | "The same memory in your IDE, through the Forge MCP server, before you write a line of code." |
| 3:30–3:50 | Decision Log page: stats, search, detail with Owner's teams (Teamwork Graph), Supersede → lineage | "A living decision log: owners, teams from the Teamwork Graph, lineage, and review dates so decisions don't go stale." |
| 3:50–4:05 | Slide: architecture + "$0 to run, permission-aware, explainable" + bonus badges | "Built on Forge, Rovo, MCP and the Teamwork Graph. Decision Memory: ship with confidence, because your team remembers." |

## Seed data (record via comments or panel before filming)
- `Decision: Use PostgreSQL instead of MongoDB for all new services.` (rationale: transactional guarantees, one ops runbook)
- `Decision: Do not deploy to production on Fridays.`
- `Decision: Deprecate the legacy Jenkins pipelines; use GitHub Actions.`
- `Decision: No feature flags in the payments service.` (rationale: PCI audit scope)
- `Decision: All public APIs must use OAuth 2.0 instead of API keys.` (review date: next quarter)
