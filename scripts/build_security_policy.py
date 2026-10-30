from pathlib import Path
from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUT = Path("artifacts")
OUT.mkdir(exist_ok=True)
OUTFILE = OUT / "AutoClip_Information_Security_and_Privacy_Policy.docx"


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def border(cell, color="D9D9D9"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        element = borders.find(tag)
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "6")
        element.set(qn("w:color"), color)


def cell_padding(cell, top=90, start=110, bottom=90, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, val in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def add_text(paragraph, text, bold=False, italic=False, size=None, color=None):
    run = paragraph.add_run(text)
    run.bold = bold
    run.italic = italic
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor(*color)
    return run


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    p.paragraph_format.space_after = Pt(4)
    p.add_run(text)
    return p


def add_section(doc, number, title, body=None):
    heading = doc.add_heading(f"{number}. {title}", level=1)
    heading.paragraph_format.space_before = Pt(13)
    heading.paragraph_format.space_after = Pt(6)
    if body:
        p = doc.add_paragraph(body)
        p.paragraph_format.space_after = Pt(7)
    return heading


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.72)
section.bottom_margin = Inches(0.72)
section.left_margin = Inches(0.82)
section.right_margin = Inches(0.82)

styles = doc.styles
styles["Normal"].font.name = "Arial"
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
styles["Normal"].font.size = Pt(10.5)
styles["Normal"].paragraph_format.space_after = Pt(6)
styles["Normal"].paragraph_format.line_spacing = 1.15
for name, size in (("Title", 23), ("Heading 1", 14), ("Heading 2", 11.5)):
    style = styles[name]
    style.font.name = "Arial"
    style._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.font.bold = True

# Header and footer
header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
add_text(header, "AUTOCLIP  |  INFORMATION SECURITY AND PRIVACY", bold=True, size=8, color=(80, 80, 80))
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
add_text(footer, "AutoClip Information Security and Privacy Policy  •  Version 1.0  •  30 October 2026", size=8, color=(90, 90, 90))

# Title block
p = doc.add_paragraph(style="Title")
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_text(p, "AutoClip Information Security and Privacy Policy", bold=True, size=23)
# LibreOffice can inherit a colored title-rule border from the built-in Title style.
# This policy uses the required Title style but intentionally has no decorative rule.
p_pr = p._p.get_or_add_pPr()
p_bdr = p_pr.find(qn("w:pBdr"))
if p_bdr is not None:
    p_pr.remove(p_bdr)
p = doc.add_paragraph()
add_text(p, "Policy for the protection of customer, TikTok, TikTok Shop, and operational information", italic=True, size=11, color=(80, 80, 80))
p.paragraph_format.space_after = Pt(14)

table = doc.add_table(rows=4, cols=2)
table.alignment = WD_TABLE_ALIGNMENT.LEFT
table.autofit = False
for row in table.rows:
    row.cells[0].width = Inches(1.45)
    row.cells[1].width = Inches(5.2)
for i, (label, value) in enumerate([
    ("Document owner", "AutoClip operator"),
    ("Version", "1.0"),
    ("Approved on", "To be completed upon formal approval"),
    ("Effective date", "Effective when approved and adopted by the AutoClip operator"),
]):
    c0, c1 = table.rows[i].cells
    for c in (c0, c1):
        border(c); cell_padding(c); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    shade(c0, "17365D")
    add_text(c0.paragraphs[0], label, bold=True, size=9, color=(255, 255, 255))
    add_text(c1.paragraphs[0], value, size=9.5)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(12)
add_text(p, "Purpose. ", bold=True)
add_text(p, "This policy describes the security and privacy controls AutoClip uses and the operating requirements it adopts for its SaaS service. It is intended for customers, personnel, service providers, and platform partners, including TikTok Shop. It must be formally approved and operated before it is represented as an effective company policy.")

add_section(doc, "1", "Scope and principles", "This policy applies to AutoClip production systems, source code, cloud services, users with administrative or operational access, and information processed through the service. AutoClip applies least privilege, tenant separation, secure handling of secrets, and privacy-aware processing as core principles.")

add_section(doc, "2", "Information handled by the service", "AutoClip may process account and workspace data, user identifiers and contact details, uploaded media and publication metadata, TikTok and TikTok Shop connection data, product and order cache data, and operational, audit, and diagnostic records. AutoClip processes this information only to provide, secure, support, and improve the service, meet legal obligations, and respond to incidents.")

add_section(doc, "3", "Identity access and tenant isolation", "AutoClip uses authenticated user sessions and workspace-based roles: Owner, Admin, Editor, and Viewer. Database row-level security and authorization helpers restrict access by workspace and role. Application records are associated with a workspace, and database constraints link channels, media, publications, products, and related records to that workspace. Administrative actions are limited to designated platform owners and server-side administrative functions.")
add_bullet(doc, "Users receive only the access needed for their assigned workspace role.")
add_bullet(doc, "Workspace membership is checked before users access or modify workspace data.")
add_bullet(doc, "Service credentials and privileged database keys are kept out of the browser application.")

add_section(doc, "4", "OAuth tokens secrets and credentials", "AutoClip processes TikTok and TikTok Shop authorization tokens in server-side functions. Tokens are encrypted before persistent storage using AES-256-GCM with a randomly generated 96-bit initialization vector. The encrypted value is bound to its channel or connection identifier as additional authenticated data, so it cannot be successfully reused in another connection context. The encryption key is configured as a server secret and is not included in the frontend application. Browser clients cannot select the database records that contain TikTok Shop tokens; they receive only a restricted connection summary.")
add_bullet(doc, "OAuth authorization state values are single-use and time-limited.")
add_bullet(doc, "TikTok Shop token refresh and API signing occur in server-side functions.")
add_bullet(doc, "Secrets are provided through deployment configuration; they must not be committed to source control, exposed in client code, or written to ordinary support records.")

add_section(doc, "5", "Encryption and secure transmission", "AutoClip is designed to use HTTPS endpoints for web access, OAuth redirects, TikTok and TikTok Shop API requests, and media delivery. Stored OAuth credentials are encrypted as described in Section 4. Media delivery uses short-lived signed tokens for the documented media proxy flow. AutoClip does not rely on encryption as a substitute for authorization; access decisions are also enforced through authenticated server functions, role checks, and database row-level security.")

add_section(doc, "6", "Data retention deletion and data subject requests", "AutoClip retains service data while it is needed to operate the applicable workspace or meet a lawful purpose. A verified account-deletion request is processed through a controlled administrative path. When a workspace is deleted, related database records are removed through configured relationships, and the administrative deletion flow includes removal of workspace media from storage. Data may be retained only to the minimum extent necessary for security, fraud prevention, dispute resolution, legal obligations, or technical backup cycles. Requests may be submitted through the published AutoClip data-deletion channel.")

add_section(doc, "7", "Logging monitoring and auditability", "AutoClip maintains application audit-log structures and records publication, connection, and operational events. Access to audit records is restricted to authorized workspace administrators or server-side operations, as applicable. Logs and diagnostic records must be handled as confidential operational data. Tokens, encryption keys, passwords, and other secrets must not be deliberately recorded in logs. Suspected anomalous activity, authorization failures, service errors, and security alerts are reviewed and escalated under Section 9.")

add_section(doc, "8", "Secure development vulnerability and supplier management", "AutoClip maintains source-controlled application code, database migrations, and automated tests for key authorization and token-cryptography behaviors. Security-relevant changes must be reviewed before release, and identified vulnerabilities or dependency updates must be prioritized according to risk. Cloud and platform suppliers are selected and configured with regard to their ability to support AutoClip's security and privacy obligations. This policy does not assert a certification or control operated by a supplier beyond the supplier's own published commitments.")

add_section(doc, "9", "Security incident response and notification", "AutoClip adopts the following incident process. This section is the documented procedure for identifying, containing, investigating, assessing, communicating, and recording security incidents. The AutoClip operator must assign a responsible incident lead and maintain the security contact channel before treating this procedure as operational.")

incident_rows = [
    ("Identify and triage", "Any suspected unauthorized access, disclosure, loss, alteration, malware event, service compromise, or material availability event is recorded promptly. The incident lead assigns an initial severity and preserves available evidence."),
    ("Contain and protect", "The team restricts access, revokes or rotates affected credentials or tokens where appropriate, isolates affected components, and takes proportionate steps to prevent further impact."),
    ("Investigate and assess", "The team determines affected systems, data categories, tenants, individuals, duration, likely cause, and the risk of harm. The assessment is updated as facts become available."),
    ("Notify", "Where required by applicable law, contract, or platform terms, AutoClip notifies affected customers, individuals, regulators, and relevant partners, including TikTok Shop when its data or integration may be affected, without undue delay and within applicable deadlines. Notices describe known facts, affected data, mitigation steps, and a contact point, subject to preserving evidence and security."),
    ("Recover and learn", "The team restores services safely, verifies remediation, records decisions and communications, and tracks corrective actions to completion. A post-incident review is completed for material incidents."),
]
table = doc.add_table(rows=1, cols=2)
table.alignment = WD_TABLE_ALIGNMENT.LEFT
table.autofit = False
table.columns[0].width = Inches(1.45)
table.columns[1].width = Inches(5.2)
hdr = table.rows[0].cells
for c, txt in zip(hdr, ("Stage", "Required action")):
    shade(c, "17365D"); border(c); cell_padding(c); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    add_text(c.paragraphs[0], txt, bold=True, size=9, color=(255, 255, 255))
set_repeat_table_header(table.rows[0])
for stage, action in incident_rows:
    cells = table.add_row().cells
    for c in cells:
        border(c); cell_padding(c); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    add_text(cells[0].paragraphs[0], stage, bold=True, size=9.2)
    add_text(cells[1].paragraphs[0], action, size=9.2)

add_section(doc, "10", "Privacy and LGPD", "AutoClip handles personal data in accordance with the purposes described in its published Privacy Policy and applicable privacy law, including Brazil's Lei Geral de Proteção de Dados Pessoais where applicable. AutoClip limits access to authorized roles, responds to verified data subject requests, applies safeguards proportionate to the nature of the data, and considers privacy impacts when changing processing activities.")

add_section(doc, "11", "Roles review and exceptions", "The AutoClip operator is responsible for approving this policy, assigning the incident lead, maintaining the published privacy and deletion contact channels, and reviewing this policy at least annually and after a material security incident or major change to processing. Exceptions require documented approval and compensating safeguards appropriate to the risk.")

add_section(doc, "12", "Security contact", "For security and privacy matters, including suspected incidents and data requests, contact: diogos.nascimento@outlook.com. The operator must monitor this channel and maintain a current escalation path after formal adoption of this policy.")

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(14)
add_text(p, "Approval record", bold=True, size=11)
table = doc.add_table(rows=2, cols=2)
table.alignment = WD_TABLE_ALIGNMENT.LEFT
for i, label in enumerate(("Legal entity or responsible operator", "Authorized approver name title date and signature")):
    c0, c1 = table.rows[i].cells
    for c in (c0, c1):
        border(c); cell_padding(c, top=70, bottom=70); c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    shade(c0, "EAF0F6")
    add_text(c0.paragraphs[0], label, bold=True, size=9)
    add_text(c1.paragraphs[0], "", size=9)

doc.save(OUTFILE)
print(OUTFILE)
