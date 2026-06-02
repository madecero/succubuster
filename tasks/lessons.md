# Lessons Learned

## Email formatting (2026-05-22)

**Mistake:** Drafted a reply to Bryan Neubauer using the `create-reply-draft` `Comment` field with plain-text newlines. It rendered in Outlook as one flat block — the numbered list collapsed with no spacing. Michael deleted it.

**Rule:** Never use plain-text newlines or the `Comment` field for multi-paragraph email. Always build the body as HTML (`Message.body.contentType: "html"`) — paragraphs in `<p>`, numbered lists in real `<ol><li style="margin-bottom:14px;">`. See the `email-drafting` skill (`.claude/skills/email-drafting/SKILL.md`) — read it before ANY email task.
