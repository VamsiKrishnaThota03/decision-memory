# Marketplace listing kit (free app)

Use this for the **Best Marketplace published app** bonus. Submitting the listing is enough; then paste the review ticket link into Devpost.

## 1. Before you submit
1. Deploy to production: `forge deploy -e production`
2. In the developer console (<https://developer.atlassian.com/console/myapps/5f7d5a1f-7d63-4e37-80ee-a2e55c108c9f>), open **Distribution**, set **Sharing** on, and fill in:
   - **Privacy policy URL:** host `docs/PRIVACY.md` publicly, for example as a GitHub Gist or GitHub Pages. Don't use an Amazon-hosted page.
   - **Does the app store personal data?** Yes. It stores Atlassian account IDs only.
   - **Security / data residency:** Runs on Atlassian, with no egress.
3. Copy the **installation link** from Distribution. Judges need it for the Devpost "Access" field.
4. Create a Marketplace vendor (partner) profile: <https://marketplace.atlassian.com/manage/vendors/create>. It's free.
5. In the console, open **Distribution → List on Marketplace** and start the listing for a **free** app.

## 2. Listing copy

**Name:** Decision Memory

**Tagline (≤ 80 chars):** Remember team decisions and catch work that contradicts them, automatically.

**Summary (≤ 250 chars):**
Capture decisions from Jira comments, Confluence pages and Rovo. Decision Memory checks every new issue against them and flags conflicts with the evidence, the reason and the owner, before the wrong thing gets built.

**Highlights:**
1. **Capture where you already work.** "Decision:" in a Jira comment, the /decision block, a Confluence page action, ADR import, or Rovo chat.
2. **Catch contradictions early.** New issues and comments are checked automatically, with one clear comment, a label and an issue panel.
3. **Understands intent.** "Add MongoDB" is a conflict; "migrate off MongoDB" implements the decision.
4. **Ask why in Rovo or your IDE.** A Rovo agent, reusable actions and an MCP server for Claude Code and Cursor.
5. **Decisions that stay fresh.** Supersede with lineage, review dates and reminders, plus insights on conflicts caught.

**Category:** Project management · IT & software development
**Keywords:** decisions, ADR, architecture decision record, governance, Rovo, AI agent, MCP, knowledge, compliance, engineering standards

## 3. Screenshots (1840×900 recommended)
1. A conflict comment on an issue, with the evidence and owner.
2. The issue panel showing a conflict card and "Implements".
3. The Decision Log with stats and table.
4. The Insights tab with charts.
5. Rovo chat answering "Why do we use PostgreSQL?"
6. The Confluence "Capture decisions" dialog.

## 4. Trust and security answers
- **Data storage:** Forge SQL (Atlassian-hosted). No external storage.
- **Egress:** none.
- **Authentication:** Forge platform. Users act as themselves (`asUser`).
- **Personal data:** Atlassian account IDs only. No email addresses or names are stored.
- **Data deletion:** all data is deleted on uninstall.
- **Logging:** errors only; no user content is logged.
