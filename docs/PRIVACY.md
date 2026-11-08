# Decision Memory: privacy policy

_Last updated: 2026-11-08_

Decision Memory is a Forge app that runs entirely on Atlassian's infrastructure ("Runs on Atlassian"). It has no external servers and makes no outbound network calls.

## What data the app stores
In Forge SQL, inside your Atlassian site's app storage:
- **Decisions:** title, statement, rationale, tags, guardrail terms, status, review date, source link, related issue key and project key, and the Atlassian account IDs of the owner and creator.
- **Conflict alerts:** issue key, decision ID, confidence, reason, status (open, acknowledged or dismissed), and the account ID of the person who resolved the alert.
- **Settings:** the toggles on the admin page, and the Teamwork Graph connection ID if an admin connects one.

The app does **not** store issue descriptions, comment bodies or page bodies. It reads them only at the moment it checks or captures a decision.

## Where the data goes
- Nowhere outside Atlassian. Data stays in your site's Forge storage, in the data residency region of your site.
- **Teamwork Graph (optional, admin-enabled):** site-wide decisions are published as documents in your organisation's Teamwork Graph. Project-scoped decisions are never published.
- **Rovo / MCP:** when a user asks, decisions they are allowed to see are returned to the Rovo agent or MCP client acting on that user's behalf.

## Access control
- User-facing reads run as the user, so Jira and Confluence permissions apply.
- Project-scoped decisions are visible only to users who can browse that project.
- Comments with restricted visibility, and issues with a security level, are never captured.

## Retention and deletion
Data is kept until the app is uninstalled. Uninstalling deletes all app storage, following Atlassian's Forge data deletion process. Individual decisions can be revoked from the Decision Log. To request deletion, contact the developer.

## Contact
Vamsi Krishna Thota: vamsikrishnathota483@gmail.com
