---
model: PG-32
name: Surge generator, 30 kV
slug: pg-32-surge-generator
family: 2
order: 4
shortName: surge generator
description: "Portable surge and DC set, 0 to 30 kV and 1,800 J, that breaks down cable faults so they can be pre-located and pinpointed."

keyFigures:
  - { label: DC output, value: "0–30", unit: kV }
  - { label: Surge energy, value: "1,800", unit: J }
  - { label: Discharge period, value: "5", unit: s }
  - { label: Weight, value: "45", unit: kg }
tileFigures:
  - { label: DC output, value: "0–30", unit: kV }
  - { label: Energy, value: "1,800", unit: J }
  - { label: Weight, value: "45", unit: kg }

images:
  - src: ../../assets/img/pg-32.jpg
    alt: "PG-32 surge generator: a grey steel case with an orange frame, two carry handles on top and an accessory pouch on the front."
    caption: Three-quarter view with the accessory pouch fitted.
    thumbLabel: three-quarter view
  - src: ../../assets/img/pg-32-front.jpg
    alt: "Front view of the surge generator with the accessory pouch fitted to its front panel."
    caption: Front view with the accessory pouch.
    thumbLabel: front
  - src: ../../assets/img/pg-32-panel.jpg
    alt: "PG-32 control panel from the front: kV meter, level bubble, earth and auxiliary earth terminals, mains inlet and switch, voltage dial, mode selector and the single-shot button."
    caption: "Control panel: kV meter, level bubble, earth terminals, voltage dial, DC / single / period selector."
    thumbLabel: control panel
  - src: ../../assets/img/pg-32-high-angle.jpg
    alt: "Surge generator seen from a raised angle, showing the top control panel, carrying handles and front pouch."
    caption: Top control panel and carrying handles.
    thumbLabel: top
  - src: ../../assets/img/pg-32-rear.jpg
    alt: "PG-32 from the rear corner, without the pouch: cooling fans behind grilles and the recessed side handle."
    caption: "Rear corner: cooling fans and the recessed side handle."
    thumbLabel: rear and fans
  - src: ../../assets/img/pg-32-side.jpg
    alt: "Surge generator at a three-quarter angle, showing the front pouch and the recessed side handle."
    caption: Three-quarter view with the side handle.
    thumbLabel: side
  - src: ../../assets/img/pg-32-accessories.jpg
    alt: "PG-32 with its accessories laid out in front: clamp leads, earth leads, the discharge probe and two T-handle earth spikes."
    caption: "With accessories: clamp and earth leads, discharge probe, earth spikes."
    thumbLabel: with accessories
  - src: ../../assets/img/pg-32-leads.jpg
    alt: "Accessory set laid out flat: two earth spikes, a discharge probe, heavy-duty clamp leads and earth leads with clips."
    caption: Earth spikes, discharge probe and test leads.
    thumbLabel: leads

datasheet:
  url: /datasheets/pg-32.pdf
  note: 2 pages, English

features:
  - "0 to 30 kV DC output, 1,800 J surge energy"
  - "Three modes on one selector: DC, single shot and period"
  - Automatic discharge every 5 s in period mode
  - Arc reflection (ARM) with the TDR-901, through an ARM filter
  - Internal 800 W isolation transformer
  - Pointer kV meter and an LED scale around the voltage knob
  - Bubble level and two carrying handles; can be installed in a vehicle
  - Supplied with a calibration approval and certificate
applications: Breaking down high-resistance and intermittent faults in buried medium-voltage cables, for pre-location by arc reflection and for acoustic pinpointing; DC testing.

fitLead: The PG-32 is step 2. It prepares the fault for the reflectometer before it and the pinpointer after it.

specsSource: Values from the product datasheet. Panel details and the discharge period as shown on the unit.
specs:
  - group: Output and methods
    rows:
      - { label: DC output voltage, value: "0 to 30", unit: kV }
      - { label: "Surge energy, nominal", value: "1,800", unit: J }
      - { label: Operating modes, value: "DC, single shot, period" }
      - { label: Discharge period, value: "Automatic, every 5 {s}, in period mode" }
      - { label: Test methods, value: "DC test, surge discharge, arc reflection (ARM)" }
      - { label: Isolation transformer, value: "Internal, 800", unit: W }
  - group: Indication and protection
    rows:
      - { label: Output voltage display, value: "Pointer kV meter; LED scale around the voltage knob, 0 to 30 {kV}" }
      - { label: Panel indicators, value: "Closed and Separated beside the HV switch; Over-V and Under-V beside the mains inlet, as labelled" }
      - { label: Protection systems, value: "F.U and F.Ω", slot: function to confirm }
      - { label: Level indicator, value: Bubble level on the panel }
  - group: Connections
    rows:
      - { label: Earth, value: Ground and auxiliary ground terminals }
      - { label: Reflectometer, value: TDR-901 or a higher model }
      - { label: ARM method, value: Through an ARM filter }
  - group: Power and environment
    rows:
      - { label: Input supply, value: "AC 220 {V}, 50 {Hz} (as rated on the unit)" }
      - { label: Operating temperature, value: "−10 to 40", unit: "°C" }
      - { label: Relative humidity, value: "5 to 80", unit: "%" }
      - { label: Protection class, value: IP43 }
  - group: Mechanical
    rows:
      - { label: "Dimensions (L × W × H)", value: "540 × 400 × 500", unit: mm }
      - { label: Height with top handle, value: "59", slot: unit to confirm }
      - { label: Weight, value: "45", unit: kg }
      - { label: Case, value: "Steel, powder-coated: orange frame, grey panels" }
      - { label: Cooling, value: Fans behind grilles in the side panels }
      - { label: Handles, value: "Two carrying handles on top, one recessed at the side" }
      - { label: Transport, value: Can be installed in a vehicle }
  - group: Service
    rows:
      - { label: Calibration, value: Approval and certificate supplied }
      - { label: Manual, value: English, slot: English manual availability }

inTheBox:
  - { item: Protection earth rod, qty: "1" }
  - { item: Cable clamps, qty: "2" }
  - { item: Discharge probe with earth cable, qty: "1" }
  - { item: Output cable, qty: 5 m }
  - { item: Protection earth cable, qty: 5 m }
  - { item: Power cable, qty: 1.5 m }
  - { item: "Accessory bag, attached to the case", qty: "1" }
inTheBoxFigure:
  image: 6
  alt: "The PG-32 with its accessories laid out in front: red clamp leads, earth leads with clips, the discharge probe and two T-handle earth spikes."
  caption: "As photographed. The two T-handle earth spikes are not on the datasheet list:"
  slot: confirm scope of supply

worksWith: [tdr-901-time-domain-reflectometer, arm-filter, ap-01-acoustic-pinpointer]
worksWithLead: Through the ARM Filter the PG-32 feeds the TDR-901 for arc reflection, and its discharges are what the AP-01 listens for.

quoteBand:
  heading: Price a PG-32 for your network.
  lead: Tell us the cable voltage and length, and whether you need the TDR-901 and AP-01 with it.

seo:
  title: "PG-32 surge generator, 30 kV"
  description: "PG-32: portable surge and DC generator, 0 to 30 kV, 1,800 J, discharge every 5 s, for locating faults in underground medium-voltage cables."
---

The PG-32 charges a capacitor and discharges it into the faulty cable. The discharge breaks down a high-resistance or intermittent fault, so the reflectometer can see it and the pinpointer can hear it.

Output is set from 0 to 30 kV DC, with 1,800 J of surge energy. One selector on the panel chooses DC, single shot or period. Single shots suit pre-location; in period mode the set discharges by itself every 5 seconds while the crew walks the route with the pinpointer. Through an ARM filter it feeds the TDR-901 for arc reflection.

The steel case weighs 45 kg and is rated IP43. It has two top handles, cooling fans, a bubble level, a pointer kV meter and an internal 800 W isolation transformer. The unit is rated AC 220 V, 50 Hz, and it can be installed in a vehicle.
