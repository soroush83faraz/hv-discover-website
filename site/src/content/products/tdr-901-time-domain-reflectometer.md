---
model: TDR-901
name: Time domain reflectometer
slug: tdr-901-time-domain-reflectometer
family: 1
order: 1
shortName: reflectometer
description: Battery-powered reflectometer that measures the distance to a cable fault in metres, before the surge generator and the pinpointer go out.

keyFigures:
  - { label: Range, value: "100", unit: km }
  - { label: Sampling, value: "200", unit: MHz }
  - { label: Battery, value: "7", unit: h }
  - { label: Weight, value: "3.5", unit: kg }
tileFigures:
  - { label: Range, value: "100", unit: km }
  - { label: Sampling, value: "200", unit: MHz }
  - { label: Battery, value: "7", unit: h }

images:
  - src: ../../assets/img/tdr-901.jpg
    alt: TDR-901 reflectometer open in its orange hard case, the 7-inch screen showing a trace above a row of soft keys and a rotary dial.
    caption: "In its hard case, lid open: 7-inch touch screen, soft keys and rotary dial."
    thumbLabel: in its case
  - src: ../../assets/img/tdr-901-kit.jpg
    alt: "TDR-901 with its kit: a test lead plugged into the front socket, red and black clip leads, a mains adapter and an orange impulse current coupler."
    caption: "With the kit: test lead, clip leads, mains adapter and impulse current coupler."
    thumbLabel: with the kit
  - src: ../../assets/img/tdr-901-accessories.jpg
    alt: "Accessories laid out: test lead with crocodile clips, mains adapter, stylus and an impulse current coupler with its cable."
    caption: Test lead, coupler, mains adapter and stylus.
    thumbLabel: accessories
  - src: ../../assets/img/tdr-901-transport-case.jpg
    alt: "Open orange transport case with the instrument case nested in foam and accessories in the side compartment."
    caption: Instrument case inside its transport case.
    thumbLabel: transport case
  - src: ../../assets/img/tdr-901-closed.jpg
    alt: "Closed orange transport case with a metal nameplate on the lid."
    caption: Rugged transport case, closed.
    thumbLabel: closed case

datasheet:
  url: /datasheets/tdr-901.pdf
  note: 2 pages, English

features:
  - "Three methods: low-voltage pulse (TDR), arc reflection (ARM) and impulse current (ICM)"
  - 200 MHz sampling and a 100 km measuring range
  - 7-inch touch screen, readable in sunlight
  - Adjustable gain
  - Traces kept in internal memory and sent to a computer over USB
  - Internal rechargeable battery for up to 7 hours
  - Connects to the PG-32 surge generator
  - Supplied with a calibration approval and certificate
applications: Pre-location of open circuits and short circuits in buried power cables, and of high-resistance faults together with a surge generator.

fitLead: The TDR-901 is step 1. It gives the distance that the surge generator and the pinpointer then work towards.

specsSource: Values from the product datasheet. Panel details as seen on the unit.
specs:
  - group: Measurement
    rows:
      - { label: Test methods, value: "TDR, ARM, ICM" }
      - { label: Measuring range, value: "100", unit: km }
      - { label: Sampling frequency, value: "200", unit: MHz }
      - { label: Measurement error, slot: to confirm }
      - { label: Gain, value: Adjustable }
      - { label: Maximum clarity, value: "0.4", unit: micron, slot: meaning to confirm }
      - { label: Surge pulse reception, value: "32", unit: V, slot: meaning to confirm }
  - group: Display and data
    rows:
      - { label: Display, value: "7 {in} touch screen, readable in sunlight" }
      - { label: Controls, value: "Soft keys under the screen, rotary dial, power key" }
      - { label: Memory, value: "Internal, for stored traces" }
      - { label: Computer link, value: "USB, port on the panel" }
  - group: Connections
    rows:
      - { label: Test lead, value: Screw-lock socket on the panel }
      - { label: Jack socket, value: On the panel, slot: function to confirm }
  - group: Power and environment
    rows:
      - { label: Battery, value: "Internal, rechargeable, up to 7", unit: h }
      - { label: Input supply, value: "AC 185 to 230 {V}, 50 to 60 {Hz}" }
      - { label: Operating temperature, value: "−10 to 40", unit: °C }
      - { label: Relative humidity, value: "5 to 90", unit: "%" }
      - { label: Protection class, value: IP43 }
  - group: Mechanical
    rows:
      - { label: Dimensions (H × W × L), value: "81 × 218 × 274", unit: mm }
      - { label: Weight, value: "3.5", unit: kg }
      - { label: Body, value: Plastic }
      - { label: Case, value: "Orange moulded hard case, gasketed lid with two latches" }
  - group: Service
    rows:
      - { label: Calibration, value: Approval and certificate supplied }
      - { label: Manual, value: English, slot: English manual availability }

inTheBoxNote: From the datasheet. Quantities to confirm.
inTheBox:
  - item: USB cable for data transfer
  - item: Cable to the short-gap filter
  - item: Filter
  - item: Charging cable
  - item: Touch pen
  - item: Carrying case
inTheBoxFigure:
  image: 1
  alt: "The TDR-901 open with its kit: a test lead in the front socket, red and black clip leads, a mains adapter and an orange impulse current coupler with its cable."
  caption: "As photographed. The clip leads, mains adapter and impulse current coupler are not named on the datasheet list:"
  slot: confirm scope of supply

worksWith: [arm-filter, pg-10-surge-generator, pg-32-surge-generator]
worksWithLead: Alone, the TDR-901 finds opens and shorts. A high-resistance fault needs a surge generator as well, joined to the reflectometer through the ARM Filter.

quoteBand:
  heading: Price a ~TDR-901~ for your network.
  lead: Tell us the cable types and lengths you test, and whether you need the ARM Filter and a surge generator with it.

seo:
  title: "TDR-901 time domain reflectometer"
  description: "TDR-901: battery-powered time domain reflectometer, 100 km range, 200 MHz sampling, for pre-locating faults in underground power cables."
---

The TDR-901 sends a low-voltage pulse into the cable and times the echo. An open circuit, a short circuit or a joint shows on the trace as a reflection, and the instrument turns the delay into a distance in metres. It samples at 200 MHz over a range of up to 100 km.

A high-resistance fault does not reflect a low-voltage pulse. For those, the TDR-901 works with a surge generator: through the ARM Filter for arc reflection (ARM), or with the impulse current coupler for the impulse current method (ICM). Gain is adjustable, and traces are stored inside and copied to a computer over USB.

The 7-inch touch screen stays readable in sunlight, with soft keys and a rotary dial beside it. The internal battery lasts up to 7 hours. The instrument weighs 3.5 kg and sits in an orange hard case with a gasketed lid and two latches.
