---
version: 1
slug: "packages-client-web"
primary_target: "packages/client/web"
related_targets: []
---

# Web client shell

Visitor mode: **Operate**. The user is mid-task in a local tool they opened to
finish a document; expression never outranks scanability, state, or a familiar
affordance.

Audience and job: a knowledge worker producing a deliverable (workbook, deck,
document, PDF) from the chat, and a developer reading the same transcript for
telemetry. Both need "where am I", "what is it doing", and "what came out".

Constraints: React plugin architecture, CSS Modules over shared custom
properties, no component library, no Tailwind. Feature sheets may consume only
semantic aliases; light/dark overrides live solely in the theme owner. Product
copy is Chinese; code comments are English.

## Direction contract

THESIS: A macOS window rendered in the browser — one canvas, three columns, and
cards that float on a grey ground. It refuses the category default for an agent
harness: a dark monospace terminal with a coloured log stream.

OWN-WORLD: A closed neutral ramp (canvas → chrome → card → elevated) plus one
accent that marks only things you can press; 13px controls over 15px prose;
8px/12px/16px corners assigned by the size of the thing rounded; a three-step
elevation ladder where each step is a hairline plus a contact and an ambient
shadow; translucency reserved for the dialog scrim.

STORY: The user lands on a composer, states a task, watches tool rows report
what happened without shouting, and takes a file out. The session list answers
"where am I" with the one accent fill in the column.

FIRST VIEWPORT: A 260px source-list sidebar (30px title bar, one 30px New
Session button, a labelled session list, Settings pinned to the foot) beside a
centred composer card — whale mark and 26px title above a 16px-rounded input
card with the attach control, mode chips, model pop-up, and a single accent
send button. The whole column is white; the sidebar is the only grey.

FORM: Candidate 5 of 7 grounded directions; seed key `a77926f6` (scope
direction, mode operate; assigned index 5, challengers weighed and recorded).

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
