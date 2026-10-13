---
model: AP-01
name: Acoustic pinpointer
slug: ap-01-acoustic-pinpointer
family: 3
order: 5
shortName: acoustic pinpointer
description: Receiver and ground sensor that hear the surge discharge through the ground, so the crew digs in the right place.

keyFigures:
  - { label: Frequency range, value: "80–1500", unit: Hz }
  - { label: Filters, value: "4" }
  - { label: Accuracy, value: "0.1", unit: m }
  - { label: Battery, value: "9", unit: h }
tileFigures:
  - { label: Band, value: "80–1500", unit: Hz }
  - { label: Filters, value: "4" }
  - { label: Battery, value: "9", unit: h }

images:
  - src: ../../assets/img/ap-01.jpg
    alt: "AP-01 acoustic pinpointer assembled: the ground sensor on a telescopic rod, the hand-held receiver on a neck strap, and headphones."
    caption: "Assembled: ground sensor on the telescopic rod, receiver on its neck strap, headphones."
    thumbLabel: assembled
  - src: ../../assets/img/ap-01-case.jpg
    alt: "AP-01 packed in its orange hard case: the orange ground sensor, the receiver, headphones and the neck strap in cut foam."
    caption: Packed in the hard case.
    thumbLabel: in the case

datasheet:
  url: /datasheets/ap-01.pdf
  note: 2 pages, English

features:
  - "Acoustic band 80 to 1500 Hz, 80 dB acoustic channel"
  - "Four filters: all-pass, low-pass, high-pass and band-pass"
  - Noise reduction and adaptive noise reduction
  - "4.5-inch colour display showing the signal"
  - Adjustable sensor height; adapters for soil and lawn
  - "9 hours per charge from a 3.7 V, 6400 mAh lithium battery"
  - "Receiver and sensor 2.4 kg together"
  - Supplied with a calibration approval and certificate
applications: Acoustic pinpointing of faults in buried power cables after pre-location, while a surge generator such as the PG-10 or PG-32 fires.

fitLead: The AP-01 is step 3. It starts from the distance the reflectometer measured, and it needs a surge generator firing.

specsSource: Values from the product datasheet. Receiver and sensor details as seen on the unit.
specs:
  - group: Acoustic
    rows:
      - { label: Frequency range, value: "80 to 1500", unit: Hz }
      - { label: Filters, value: "4: all-pass, low-pass, high-pass, band-pass" }
      - { label: Acoustic channel, value: "80", unit: dB }
      - { label: Noise reduction, value: Noise reduction and adaptive noise reduction }
      - { label: Measurement accuracy, value: "0.1", unit: m }
      - { label: Maximum clarity, value: "0.4", unit: micron, slot: meaning to confirm }
  - group: Receiver and sensor
    rows:
      - { label: Display, value: "4.5 {in}, colour, signal trace and level bars" }
      - { label: Controls, value: "Four-way pad and four keys" }
      - { label: "Receiver dimensions (H × W × L)", value: "55 × 127 × 230", unit: mm }
      - { label: "Weight, receiver and sensor", value: "2.4", unit: kg }
      - { label: Body, value: Plastic and aluminium }
      - { label: Carrying, value: Receiver on a neck strap }
      - { label: Ground sensor, value: "On a telescopic rod, two screw-lock cables to the receiver" }
      - { label: Sensor height, value: Adjustable above the ground }
      - { label: Headphones, value: "Closed-back, over-ear, wired" }
  - group: Power and environment
    rows:
      - { label: Battery, value: "Lithium, 3.7 {V}, 6400 {mAh}, rechargeable" }
      - { label: Battery life, value: "9 {h} per charge" }
      - { label: Operating temperature, value: "−10 to 40", unit: "°C" }
      - { label: Relative humidity, value: "5 to 90", unit: "%" }
      - { label: Protection class, value: IP43 }
  - group: Service
    rows:
      - { label: Calibration, value: Approval and certificate supplied }
      - { label: Manual, value: English, slot: English manual availability }

inTheBoxNote: From the datasheet. Quantities to confirm.
inTheBox:
  - item: Headphones
  - item: Charger
  - item: Cable from receiver to sensor
  - item: Adapters for soil and lawn
  - item: Carrying case
inTheBoxFigure:
  image: 1
  alt: "The AP-01 packed in its orange hard case: the orange ground sensor, the receiver, coiled cables, headphones and the neck strap in cut foam."
  caption: "As photographed. The telescopic rod and the neck strap are not named on the datasheet list:"
  slot: confirm scope of supply

worksWith: [pg-10-surge-generator, pg-32-surge-generator, crt-015-cable-route-tracer]
worksWithLead: The AP-01 listens for the surges a PG-10 or PG-32 fires. The CRT-015 shows where the cable runs, so the crew walks the right line.

quoteBand:
  heading: Price an ~AP-01~ for your crew.
  lead: Tell us which surge generator you use, or add a PG-10 or PG-32 to the same quote.

seo:
  title: "AP-01 acoustic pinpointer"
  description: "AP-01: acoustic cable fault pinpointer, 80 to 1500 Hz, four filters, adaptive noise reduction, 9 hours per charge. Finds the exact spot to dig."
---

The AP-01 comes out once the distance is known and a surge generator is firing. The operator sets the ground sensor down at stops along the cable route and listens on headphones for the thump of each discharge. Where it is loudest, the fault is underneath.

Across a band of 80 to 1500 Hz, four filters (all-pass, low-pass, high-pass, band-pass) and adaptive noise reduction separate the discharge from traffic and other noise. The 4.5-inch colour screen shows the signal as a trace and level bars. Sensor height is adjustable, and adapters suit soil and lawn.

Receiver and sensor weigh 2.4 kg together. The receiver hangs on a neck strap and runs 9 hours on a 3.7 V, 6400 mAh lithium battery, and the whole set packs into an orange hard case.
