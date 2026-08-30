---
name: research-report
description: >
  Long-horizon research: gather sources with web_search/web_fetch, synthesize
  findings into an evidence-graded report or workbook, and track multi-step
  investigations across a session. Use for open-ended research questions,
  market scans, and competitor or literature reviews.
---

# Research reports

Research quality comes from separating *what sources say* from *what you
conclude*, and making that separation visible.

## Method

1. **Frame the question** in one sentence with its scope ("Which three
   competitors ship agentic spreadsheet features as of this month?"). Split
   into 3–6 sub-questions; if the user's ask is vague, state your reading of
   it before searching.
2. **Gather.** `web_search` per sub-question, `web_fetch` only the pages that
   plausibly answer it. For each source capture: claim, date, and how
   authoritative it is (primary doc > vendor post > press > blog).
3. **Cross-check.** A finding shared by two independent source classes may be
   stated plainly; anything single-sourced gets "reported" framing. Conflicts
   between sources are themselves findings — surface them.
4. **Synthesize into structure**: findings ordered by decision-relevance, not
   discovery order. Grade each: **Established** (multiple strong sources),
   **Reported** (single source), **Inference** (your reasoning — label it).
5. **Deliver**: long-form via a python-docx build script (`document-report`
   anatomy); comparative data via openpyxl with a Sources sheet; quick
   answers stay in chat. Call **deliver** on each file. Include a Sources
   section listing title, publisher, date, URL.

## Honesty rules

- Never let a searched fact appear without a source in the deliverable.
- Dates matter: say when each claim was true ("as of the source's date").
- If searches can't answer the question, say exactly what was tried and what
  came back thin — a precise gap beats confident filler.

## Pacing

For multi-hour investigations: create a goal, work sub-question by
sub-question, and report interim findings in chat before assembling the
final document.
