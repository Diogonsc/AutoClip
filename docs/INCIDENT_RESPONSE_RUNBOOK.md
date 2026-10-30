# AutoClip Incident Response Runbook

## Owner and authority

The AutoClip Owner is the Incident Lead and has authority to declare an incident, suspend affected integrations, rotate secrets and tokens, engage service providers, approve external notices, and close an incident. The security contact is `diogos.nascimento@outlook.com`.

The Owner must monitor this mailbox and record each suspected incident in the incident register below. If the Owner is unavailable, do not close a material incident until a designated delegate has reviewed the record.

## What must be reported

Treat as a suspected incident any unauthorized access, disclosure, loss, alteration, use of an OAuth token or secret, cross-workspace data access, malware event, compromised account, or material service disruption.

## First response

1. Record the UTC discovery time, reporter, affected system, and available evidence.
2. Assign a severity: Critical (active exposure or broad impact), High (confirmed exposure or material account impact), Medium (contained or limited impact), or Low (no confirmed exposure).
3. Contain the issue: disable the affected workflow, revoke or rotate affected tokens and secrets, restrict access, and preserve relevant logs.
4. Determine the affected tenants, data categories, integrations, users, duration, and likely cause.
5. Decide whether notification is required under applicable law, contract, or TikTok Shop terms. For a material TikTok Shop incident, notify TikTok Shop through the applicable Partner Center or support channel without undue delay.
6. Notify affected customers, individuals, regulators, and suppliers when required. Each notice must state the known facts, affected data, mitigation steps, and a contact channel.
7. Restore only after validating the remediation. Complete a post-incident review and track corrective actions to closure.

## Incident register

Store one protected record per incident. Do not include plaintext tokens, passwords, encryption keys, or unnecessary personal data.

| Field | Required record |
| --- | --- |
| Incident ID | Unique identifier |
| Discovery and declaration time | UTC timestamps |
| Incident Lead | AutoClip Owner or delegate |
| Severity and rationale | Critical, High, Medium, or Low |
| Systems and workspaces affected | Systems, tenant IDs, integrations |
| Data categories and exposure assessment | What may have been affected and confidence level |
| Containment and recovery actions | Actions, owner, and timestamps |
| Notifications | Recipient, legal or contractual basis, sent time, and summary |
| Evidence location | Access-controlled log, ticket, or repository reference |
| Root cause and corrective actions | Findings, owners, due dates, and closure review |

## Exercise and review

The Owner must conduct and record a tabletop exercise at least annually and after every material change to authentication, token handling, multi-tenant authorization, or TikTok Shop processing. Review this runbook after each material incident.
