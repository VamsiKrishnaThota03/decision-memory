# Demo guide: Decision Memory (target 4:30, hard limit < 5:00)

## A. One-time preparation (≈30 minutes, the day before)

### 1. Clean up the test data
DEC-1 was created during testing and overlaps with the sample data.
1. Open **Apps → Decision Log**, click **DEC-1**, then **Revoke**, with reason `Test data`.
2. Click **Load 5 sample decisions** (it appears when the log is empty, and site admins can always load it). Your keys may differ from DEC-2 … DEC-6 if you've tested more; use whatever keys you see. The samples are: Postgres over Mongo, no Friday deploys, GitHub Actions over Jenkins, no feature flags in payments, OAuth over API keys.
3. Create 2 or 3 throwaway issues and try the flows once, so the Insights charts have data.

### 2. Prepare the screens (open each in its own browser tab, in this order)
| Tab | What |
|---|---|
| 1 | Slide or blank page with the title "Decision Memory" (Keynote, Google Slides, or the README on GitHub) |
| 2 | A Jira issue `KAN-x · Event streaming for order updates` (empty) |
| 3 | Jira **Create** dialog (keep closed until filming) |
| 4 | Confluence page **"Architecture sync – Nov 2026"** containing a `/decision` block: `Use Kafka instead of RabbitMQ for event streaming.` Don't capture it yet. |
| 5 | **Apps → Decision Log** |
| 6 | Terminal with **Claude Code** connected to the MCP server (see section 3) |
| 7 | The `docs/architecture.svg` image |

### 3. Connect MCP (for the IDE segment)
1. Go to **admin.atlassian.com → Apps → Sites → vamsi-codegeist → Connected apps → Decision Memory** and enable the MCP tools.
2. In a terminal, run:
   ```bash
   claude mcp add --transport http decision-memory https://mcp.atlassian.com/forge/5f7d5a1f-7d63-4e37-80ee-a2e55c108c9f
   ```
3. In Claude Code, run `/mcp`, choose **decision-memory** and sign in. Then test one prompt.
4. If MCP can't be enabled on your site, show the same `check-conflicts` tool via **Rovo chat** with a pasted diff instead, and say "the same tool is exposed over MCP".

### 4. Connect the Teamwork Graph (optional on camera)
Go to **admin.atlassian.com → Connected apps → Decision Memory → Connections → Connect**. Then the Admin page (**Jira settings → Apps → Decision Memory**) shows **connected**.

### 5. Recording setup (free)
- **Mac:** press **Cmd+Shift+5** and choose **Record Selected Portion**. Turn on the microphone under *Options*. QuickTime works too. **OBS Studio** (free) is the fallback.
- Use a 1920×1080 browser window with zoom at **110%**, and close notifications (Focus mode on).
- Light theme, a clean bookmarks bar, and hide your email and API tokens.
- Record in **2–3 short takes** (per section below) and join them in iMovie (free). It's easier than one perfect take.

---

## B. Script (what to click and what to say)

### 0:00–0:25 · Hook (Tab 1)
> "Every team makes decisions: Postgres, not Mongo. No Friday deploys. Then they get buried in comment threads, and months later someone builds the exact opposite. **Decision Memory** gives your team a memory that speaks up. It's built on Forge, with Jira, Confluence, a Rovo agent, an MCP server and the Teamwork Graph."

### 0:25–0:55 · Capture where you already work (Tab 2)
1. On `KAN-x`, comment: `Decision: Use Kafka instead of RabbitMQ for event streaming.`
2. Refresh. The green **"Decision Memory captured DEC-7"** reply appears.
> "No new process. Write a decision in a comment, or use the native decision block. It's captured with an owner, a source link, and guardrails: what to avoid and what to prefer."

### 0:55–1:45 · The money shot: conflict caught (Tab 3)
1. **Create** an issue: `Add MongoDB cluster for recommendations service`. Open it and wait about 5 seconds, then refresh.
2. Show the ⚠️ comment: decision, evidence, *why it was decided*, owner @mention. Show the **decision-conflict** label.
3. Open the **Decision Memory panel** (the app icon under the title) and show the red Conflict card. Click **Acknowledge**.
> "Seconds after the issue is created, it's flagged. It doesn't just say *no*: it quotes the evidence, explains *why* the team decided, and tags the owner. You either align the work or supersede the decision. Nothing is silently ignored."

### 1:45–2:10 · It understands intent
1. Create `Migrate orders service off MongoDB to Postgres`. There's no warning, and the panel shows **Implements DEC-2**.
2. Optionally, comment on any issue: `Let's just push this to production on Friday`. It gets flagged by the comment check.
> "Moving *off* Mongo implements the decision, so there's no false alarm. It even catches drift in comments."

### 2:10–2:40 · Confluence (Tab 4)
1. On the Architecture sync page, open **⋯ → Capture decisions (Decision Memory)**.
2. The checklist shows the decision block. Click **Import**.
3. Optionally, insert the **Decision Log** macro on the page.
> "Most decisions live in meeting notes. One click turns them into protected decisions, with the same database as Jira, so Jira work is checked against them immediately."

### 2:40–3:20 · Rovo agent
1. Open **Rovo chat**, choose the **Decision Memory** agent, and ask: `Why do we use PostgreSQL?` It answers citing DEC-2 and the rationale.
2. On the MongoDB issue, ask: `Does this issue conflict with any team decisions?`
> "In Rovo, anyone can ask *why*, with citations. The agent's six actions are reusable tools other Rovo agents can call too."

### 3:20–3:50 · MCP in the IDE (Tab 6)
Prompt Claude Code: `I'm about to add the mongodb driver to package.json for a cache. Check it against our team decisions first.` Alternatively, stage a `package.json` change and say `check my staged diff against team decisions`.
> "The same memory reaches developers *before* they write the code, through Decision Memory's MCP server. It even reads what a diff adds to package.json, Dockerfiles or Terraform."

### 3:50–4:15 · Decision Log and insights (Tab 5)
1. Show the stats, then click a decision: rationale, owner, **Owner's teams** from the Teamwork Graph, and **History** lineage.
2. Click **Supersede** briefly (or just show the button), then open the **Insights** tab: conflicts caught and alert precision.
> "A living decision log, with owners, teams from the Teamwork Graph, history, review reminders, and insights on how many mistakes it prevented. Site-wide decisions are also published *into* the Teamwork Graph, so all of Rovo can find them."

### 4:15–4:30 · Close (Tab 7)
> "Permission-aware, explainable, and it costs nothing to run. Decision Memory: ship with confidence, because your team remembers."

---

## C. Rehearsal checklist
- [ ] The sample decisions are loaded and DEC-1 is revoked
- [ ] The Kafka decision is **not** yet recorded (you capture it live)
- [ ] Rovo shows the **Decision Memory** agent
- [ ] MCP prompt works (or you're using the Rovo fallback)
- [ ] Every tab is pre-loaded and you're logged in
- [ ] Total time is under 5:00 (aim for 4:30)

## D. After recording
1. Upload to **YouTube** with visibility **Public**. Title: *Decision Memory: Codegeist 2026 (Forge · Rovo · MCP · Teamwork Graph)*.
2. In the description, add the GitHub link and one line per bonus prize, with the timestamp where it appears.
3. Paste the link into Devpost, with the text from `docs/SUBMISSION.md`.
