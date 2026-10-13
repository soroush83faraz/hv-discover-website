---
model: PG-10
name: Surge generator, 10 kV
slug: pg-10-surge-generator
family: 2
order: 3
shortName: surge generator
description: Surge and DC test set, 10 kV and 1,000 J, that breaks down cable faults so they can be pre-located and pinpointed.

keyFigures:
  - { label: Surge ranges, value: 5/10, unit: kV }
  - { label: Surge energy, value: "1,000", unit: J }
  - { label: DC test, value: "10", unit: kV }
  - { label: Test current, value: 10/20, unit: mA }
tileFigures:
  - { label: Surge, value: 5/10, unit: kV }
  - { label: Energy, value: "1,000", unit: J }
  - { label: DC test, value: "10", unit: kV }

images: []
drawing: pg-10
drawingAlt: "Line drawing of the PG-10: a rugged steel case with two top handles, a front nameplate, a voltage meter, earth terminals and a control dial. Photo coming soon."

datasheet: null

fitLead: The PG-10 is step 2. It prepares the fault for the reflectometer before it and the pinpointer after it.

specsSource: Values from the product text on the previous website. No datasheet yet.
specs:
  - group: Output and methods
    rows:
      - { label: Surge voltage, value: "5 and 10 {kV} ranges, continuously variable", slot: third range to confirm }
      - { label: Surge energy, value: "1000 {J}, full energy in each range" }
      - { label: DC test voltage, value: Up to 10, unit: kV }
      - { label: "Test current, DC", value: 10 / 20, unit: mA }
      - { label: Operating modes, value: "Surge, arc reflection (ARM), impulse current (ICM), DC test", slot: mode names to confirm }
      - { label: Shots, value: "Single or repeated; a set sequence on request" }
  - group: Indication
    rows:
      - { label: Display, value: Colour touch screen }
  - group: Power and environment
    rows:
      - { label: AC supply, slot: to confirm }
      - { label: Operating temperature, slot: to confirm }
      - { label: Protection class, slot: to confirm }
  - group: Mechanical
    rows:
      - { label: Dimensions, slot: to confirm }
      - { label: Weight, slot: to confirm }
      - { label: Case, slot: to confirm }
  - group: Service
    rows:
      - { label: Calibration, slot: to confirm }
      - { label: Scope of supply, slot: to confirm }

worksWith: [tdr-901-time-domain-reflectometer, arm-filter, ap-01-acoustic-pinpointer]
worksWithLead: Through the ARM Filter the PG-10 feeds the TDR-901 for arc reflection, and its discharges are what the AP-01 listens for.

quoteBand:
  heading: Price a ~PG-10~ for your network.
  lead: Tell us the cable voltage and length, and whether you need the TDR-901 and AP-01 with it.

seo:
  title: "PG-10 surge generator, 10 kV"
  description: "PG-10: surge and DC test set, 5 and 10 kV ranges, 1,000 J, for breaking down and locating faults in underground power cables."
bespokeSection: surge-compare
---

The PG-10 is the smaller of the two surge generators, rated up to 10 kV and 1,000 J. It charges a capacitor and discharges it into the faulty cable, so a high-resistance or intermittent fault breaks down: the reflectometer can then pre-locate it and the pinpointer can hear it at the surface.

The surge voltage is adjusted without steps inside a 5 kV and a 10 kV range, and the full 1,000 J is available in both. The set fires one shot at a time or repeats them, and it also runs DC tests up to 10 kV at 10 or 20 mA.

Modes and settings are chosen on a colour touch screen. Dimensions, weight and supply follow with the datasheet.
