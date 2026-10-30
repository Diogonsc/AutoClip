#!/usr/bin/env python3
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

OUT = Path("output/pdf")
DATE = "30 October 2026"

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="DocTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=colors.HexColor("#14213D"), spaceAfter=6))
styles.add(ParagraphStyle(name="SubTitle", parent=styles["Normal"], fontName="Helvetica", fontSize=10, leading=14, textColor=colors.HexColor("#52606D"), spaceAfter=14))
styles.add(ParagraphStyle(name="H", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=colors.HexColor("#14213D"), spaceBefore=12, spaceAfter=6))
styles.add(ParagraphStyle(name="Body2", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.3, leading=13, textColor=colors.HexColor("#263238"), spaceAfter=5))
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10, textColor=colors.HexColor("#52606D")))
styles.add(ParagraphStyle(name="Status", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=colors.HexColor("#8A5700")))

def P(text, style="Body2"):
    return Paragraph(text, styles[style])

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D9E2EC"))
    canvas.line(18 * mm, 14 * mm, 192 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#52606D"))
    canvas.drawString(18 * mm, 9 * mm, "AutoClip | Security Evidence Package | 30 October 2026")
    canvas.drawRightString(192 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()

def evidence_table(rows):
    data = [[P("Control", "Small"), P("Evidence and current status", "Small")]]
    for left, right in rows:
        data.append([P(left, "Body2"), P(right, "Body2")])
    table = Table(data, colWidths=[48 * mm, 126 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8F1FB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#14213D")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table

def build(filename, title, subtitle, status, intro, controls, sources, next_steps, disclaimer=True):
    OUT.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT / filename), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=17*mm, bottomMargin=20*mm, title=title, author="AutoClip")
    story = [P(title, "DocTitle"), P(subtitle, "SubTitle"), P(f"EVIDENCE STATUS: {status}", "Status"), Spacer(1, 5), P(intro)]
    story += [P("Control evidence", "H"), evidence_table(controls), P("Evidence sources", "H")]
    for s in sources:
        story.append(P("• " + s))
    story += [P("Required follow-up", "H")]
    for n in next_steps:
        story.append(P("• " + n))
    if disclaimer:
        story += [Spacer(1, 8), P("This document distinguishes verified repository/workstation evidence from provider-console and operational evidence that must still be collected. It does not contain credentials, recovery codes, tokens, private keys, or customer data.", "Small")]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

build(
    "AutoClip_Q2_Network_Security_and_Cloud_Infrastructure_Evidence_2026-10-30.pdf",
    "Q2 - Network Security and Cloud Infrastructure Evidence",
    "AutoClip | Vercel and Supabase architecture, access boundaries and verification plan",
    "PARTIALLY EVIDENCED - production-console verification outstanding",
    "AutoClip is a browser-based application deployed through Vercel and backed by Supabase Auth, Postgres, Storage and Edge Functions. The application uses server-side functions for privileged operations and external TikTok/TikTok Shop calls. This document records controls evidenced by the repository and identifies the provider-console checks required for production confirmation.",
    [
        ("Transport boundary", "Application, OAuth and media paths use HTTPS URLs in the codebase. The Vercel media rewrite routes /m/:token to the Supabase media-serving function."),
        ("Access boundary", "Browser calls use authenticated sessions. Privileged service-role credentials are used server-side in Edge Functions and are not intended for browser delivery."),
        ("Tenant isolation", "Database migrations enable row-level security and use workspace-scoped authorization policies and role checks."),
        ("Token-bearing records", "The oauth_connections model is documented as service-role-only; migrations remove anon/authenticated access to token-bearing rows."),
        ("CORS", "Shared HTTP helpers allow only configured WEB_URL origins and do not return wildcard origins."),
        ("Development perimeter", "Vite development and preview servers are explicitly bound to 127.0.0.1 with strict ports; this reduces accidental local-network exposure."),
    ],
    [
        "apps/web/vercel.json; apps/web/vite.config.ts; Supabase Edge Function shared HTTP/runtime modules.",
        "supabase/migrations/20261020000002_rls.sql and 20261101000001_lock_down_tiktok_shop_tokens.sql.",
        "docs/SECURITY_OPERATIONS.md, Q2 section.",
    ],
    [
        "Capture sanitized Vercel evidence for production domains, TLS, deployment access and production-scoped environment-variable names.",
        "Capture sanitized Supabase evidence for API redirect/origin settings, Edge Function secret names, RLS and Storage policies.",
        "Record the production project identifiers, reviewer, date, findings and closure references each quarter.",
    ],
)

build(
    "AutoClip_Q3_Endpoint_Protection_and_Anti_Malware_Evidence_2026-10-30.pdf",
    "Q3 - Endpoint Protection and Anti-Malware Evidence",
    "AutoClip | Ubuntu administrative workstation controls and evidence collection",
    "PARTIALLY EVIDENCED - updates pending; firewall and endpoint-protection decision outstanding",
    "The AutoClip administrative workstation runs Ubuntu 26.04.1 LTS. A read-only evidence collection was executed on 30 October 2026. The evidence confirms automatic update configuration and session-lock settings, while also identifying operational work that must be completed before the endpoint control can be closed.",
    [
        ("Automatic updates", "apt-daily.timer and apt-daily-upgrade.timer were enabled and active. APT periodic package-list and unattended-upgrade settings were both set to 1."),
        ("Pending updates", "Updates were pending for the kernel and other system components at collection time. The endpoint must be updated and rebooted where required before closure."),
        ("Session protection", "GNOME lock-enabled was true; idle-delay was 300 seconds; lock-delay was zero seconds. Practical unlock-with-password confirmation remains required."),
        ("Account password", "The local administrative account reported a defined password. Password quality controls previously recorded include pwquality minimum length 12, minimum classes 3, maximum repeat 3, dictionary checking and enforcing mode."),
        ("Host firewall", "Firewall status was not collected because the command requires administrative privilege. It remains a required documented decision."),
        ("Antimalware / EDR", "No active supported antimalware or EDR service was identified by the non-privileged collection. A managed EDR, on-demand scanner, or risk-based documented decision is required."),
    ],
    [
        "scripts/collect_ubuntu_security_evidence.sh and its 30 October 2026 execution output.",
        "Q4 workstation verification record for GNOME session lock and password controls.",
        "docs/SECURITY_OPERATIONS.md, Q3 section.",
    ],
    [
        "Apply and verify pending security updates; reboot if the installed kernel or service updates require it; retain a dated post-update collection.",
        "Collect firewall status with authorized administrative access and record the inbound-service exposure decision.",
        "Select and document endpoint-protection coverage, ownership, alert handling and scan/update cadence.",
        "Perform and capture the practical five-minute lock and password-unlock test.",
    ],
)

build(
    "AutoClip_Q6_Data_Encryption_and_Protection_Evidence_2026-10-30.pdf",
    "Q6 - Data Encryption and Protection Evidence",
    "AutoClip | Token encryption, transport security and cloud data protection",
    "PARTIALLY EVIDENCED - repository controls confirmed; provider at-rest evidence outstanding",
    "This document separates application-level cryptographic controls demonstrated by source code from cloud-provider controls that must be evidenced through the active Supabase and Vercel projects. No encryption key, token, secret value or user data is included.",
    [
        ("OAuth token encryption", "TikTok and TikTok Shop Edge Functions import a server-side TOKEN_ENCRYPTION_KEY and encrypt stored access/refresh tokens with AES-256-GCM. A 96-bit IV is generated and channel/connection identifiers are used as additional authenticated data."),
        ("Key boundary", "The token-encryption key and service-role key are read by server-side functions. The frontend configuration does not contain the service-role key."),
        ("Transport", "Application, OAuth, TikTok/TikTok Shop API and media URLs are HTTPS in the source code. Production TLS/domain evidence is still required."),
        ("Database access", "Token-bearing connection rows are restricted from anon/authenticated database access; server-side functions use service-role access only where required."),
        ("Media access", "The media-serving flow validates a short-lived HMAC-SHA256 signed token before returning media. This is an authorization control in addition to encrypted transport."),
        ("Cloud data at rest", "Postgres and Storage at-rest encryption is not established by this repository. Obtain the applicable Supabase provider documentation and project/service evidence before representing it as confirmed."),
    ],
    [
        "supabase/functions/_shared/crypto.ts, runtime.ts, media-token.ts and media-serve.ts.",
        "TikTok/TikTok Shop Edge Functions and token-storage migrations.",
        "docs/SECURITY_OPERATIONS.md, Q6 section; AutoClip Information Security and Privacy Policy v1.0.",
    ],
    [
        "Capture the Supabase secret-name inventory and a dated key-rotation/owner record without exposing values.",
        "Capture Vercel domain/TLS evidence and test the production HTTPS endpoints.",
        "Obtain and retain provider evidence applicable to the project's Postgres and Storage encryption at rest.",
        "Review token/key rotation, Storage policies and RLS/grants quarterly.",
    ],
)

build(
    "AutoClip_Q7_Incident_Response_Operational_Evidence_2026-10-30.pdf",
    "Q7 - Incident Response Operational Evidence",
    "AutoClip | Response procedure, accountability, evidence register and exercise requirements",
    "PARTIALLY EVIDENCED - procedure defined; operational exercise and register evidence outstanding",
    "AutoClip has a documented incident-response runbook. It assigns the AutoClip Owner as Incident Lead, defines a monitored security contact, and requires a controlled record for each suspected incident. The procedure must be exercised and its resulting record retained before it can be treated as fully operational evidence.",
    [
        ("Authority and contact", "The AutoClip Owner is the Incident Lead and may declare incidents, suspend integrations, rotate secrets/tokens, engage suppliers, approve notices and close incidents. The documented contact is diogos.nascimento@outlook.com."),
        ("Identification and triage", "Suspected unauthorized access, disclosure, loss, alteration, token/secret use, malware, compromised accounts and material outages are in scope. Severity levels are Critical, High, Medium and Low."),
        ("Containment and recovery", "The runbook requires recording UTC discovery time, preserving evidence, restricting access, rotating affected credentials, assessing scope, validating remediation and completing post-incident review."),
        ("Notification", "The procedure requires assessment of contractual, legal and TikTok Shop notification obligations and preservation of the recipient, basis, time and summary in the incident record."),
        ("Incident register", "Required fields include incident ID, timestamps, lead, severity, systems/workspaces, data categories, containment/recovery, notifications, evidence, root cause and corrective actions."),
        ("Backup and continuity evidence", "This repository does not establish backup configuration, restoration testing or provider retention settings. Obtain the applicable provider-console or supplier evidence separately."),
    ],
    [
        "docs/INCIDENT_RESPONSE_RUNBOOK.md.",
        "AutoClip Information Security and Privacy Policy v1.0, incident-response section.",
        "docs/SECURITY_OPERATIONS.md, Q7 section.",
    ],
    [
        "Confirm the Incident Lead, monitored mailbox and delegate/escalation path in an access-controlled record.",
        "Create the protected incident register and preserve at least one completed tabletop-exercise record.",
        "Run the documented scenario: suspected exposure of one TikTok Shop refresh token; do not use real tokens in the exercise materials.",
        "Obtain and test backup/restoration evidence for the production services, then document results and remediation actions.",
    ],
    disclaimer=False,
)

build(
    "AutoClip_Q8_Vulnerability_Management_Evidence_2026-10-30.pdf",
    "Q8 - Vulnerability Management Evidence",
    "AutoClip | Dependency remediation, validation results and ongoing vulnerability process",
    "IMPLEMENTED FOR CURRENT FRONTEND FINDINGS - recurring process remains required",
    "The initial frontend dependency assessment identified Vite, esbuild, React Router, Vitest and shadcn/deepmerge advisories. The dependency graph and local development-server configuration were remediated and retested on 30 October 2026. The vulnerability-management process must continue to monitor operating-system, cloud-provider and application dependencies.",
    [
        ("Initial finding", "AC-VULN-2026-001 recorded seven frontend dependency findings in the earlier audit, including a High-severity Vite finding and Moderate-severity esbuild/React Router findings."),
        ("Dependency remediation", "Vite was updated to 8.3.5; @vitejs/plugin-react to 6.1.2; Vitest to 5.0.5; React Router to 7.18.5. The unused shadcn package was removed."),
        ("Development perimeter", "Vite development and preview servers are configured to bind to 127.0.0.1 with strict ports, reducing accidental local-network exposure."),
        ("Regression validation", "Typecheck passed; 25 automated tests passed; and the production build passed after the updates."),
        ("Post-change audit", "The post-change npm audit returned zero critical, high, moderate and low findings for the frontend dependency graph."),
        ("Ongoing management", "The operating plan requires weekly supplier/advisory monitoring, monthly dependency and Ubuntu review, pre-release testing, and documented triage/remediation targets by severity."),
    ],
    [
        "apps/web/package.json, package-lock.json and vite.config.ts.",
        "docs/VULNERABILITY_REGISTER.md, AC-VULN-2026-001.",
        "30 October 2026 validation: npm run typecheck; npm test; npm run build; npm audit.",
        "docs/SECURITY_OPERATIONS.md, Q8 section.",
    ],
    [
        "Retain each monthly scan output, reviewer, disposition and closure evidence in the protected evidence location.",
        "Monitor Vercel, Supabase, Ubuntu and TikTok supplier advisories in addition to npm dependency advisories.",
        "Reopen or create a new register entry for any new finding; do not rely on this point-in-time clean audit as ongoing assurance.",
    ],
)

print(f"Created {len(list(OUT.glob('AutoClip_Q*_Evidence_2026-10-30.pdf')))} PDF evidence files in {OUT}")
