# Using Decision Memory from Claude Code, Cursor or VS Code (MCP)

Decision Memory exposes its tools through the Forge `rovo:mcp` module:
- `search-decisions`
- `get-decision`
- `check-conflicts` (text, a Jira issue, or a **git diff**)
- `record-decision`
- `list-due-for-review`

## 1. Enable the tools (site admin, once)
1. Open <https://admin.atlassian.com>, then **Apps → Sites → vamsi-codegeist → Connected apps**.
2. Open **Decision Memory** and turn on its MCP tools for external clients.

## 2. Connect your client
App ID: `5f7d5a1f-7d63-4e37-80ee-a2e55c108c9f`

**Claude Code**
```bash
claude mcp add --transport http decision-memory https://mcp.atlassian.com/forge/5f7d5a1f-7d63-4e37-80ee-a2e55c108c9f
```
Then run `/mcp` inside Claude Code, choose **decision-memory**, sign in to your site and approve.

**Cursor / VS Code:** add an HTTP MCP server with the same URL.

## 3. Demo prompts (for the video)
- "Before I start: I'm planning to add a MongoDB cache for the recommendations service. Check it against our team decisions."
- "Check my staged changes against team decisions." The assistant runs `git diff --staged` and passes it as `diff`.
- "Why do we use PostgreSQL? Cite the decision."
- "Record a decision: all new services must expose OpenTelemetry traces. Rationale: one tracing backend."
