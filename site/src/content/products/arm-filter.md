---
# No Overview body: the ARM Filter page explains the method instead ("What arc reflection does",
# a bespoke section of the product page, see design/mockups/product-arm-filter.html).
# No spec table: no rating, size or weight is confirmed yet (docs/04-owner-questions.md H), so the
# page shows only what the photo proves (mains inlet with switch, case) in the key figures and caption.
model: ARM Filter
name: Arc reflection filter
slug: arm-filter
family: 1
order: 2
description: Joins the reflectometer to the surge generator, so a high-resistance fault can be pre-located while it arcs.

keyFiguresLayout: text
keyFigures:
  - { label: Method, value: Arc reflection (ARM) }
  - { label: Connects, value: TDR-901 and a surge generator }
  - { label: For, value: High-resistance and intermittent faults }
  - { label: Power, value: Mains inlet with switch }
tileFiguresLayout: rows
tileFigures:
  - { label: Method, value: Arc reflection (ARM) }
  - { label: Works with, value: "TDR-901, PG-32" }

images:
  - src: ../../assets/img/arm-filter.jpg
    alt: ARM Filter in a black rugged case with the lid open, a clear cover over the connection panel, and a mains inlet with a red switch.
    caption: "Lid open: a clear cover over the connection panel, a mains inlet with switch, and a strap-on pouch."

datasheet: null

fitLead: "The ARM Filter belongs to step 1, but it works only together with step 2: it joins the reflectometer to the surge generator."

worksWith: [tdr-901-time-domain-reflectometer, pg-10-surge-generator, pg-32-surge-generator]
worksWithLead: The ARM Filter is used with a reflectometer and a surge generator, never on its own.

quoteBand:
  heading: Price the ~ARM Filter~ with your set.
  lead: Tell us which reflectometer and surge generator you use, or add the TDR-901 and a PG-32 to the same quote.

seo:
  title: "ARM Filter, arc reflection filter"
  description: "ARM Filter: joins the TDR-901 reflectometer to a PG-10 or PG-32 surge generator for the arc reflection method on high-resistance cable faults."
bespokeSection: arc-reflection
---
