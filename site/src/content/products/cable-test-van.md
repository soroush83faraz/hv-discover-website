---
# The integrated system. It is not under /products/<slug>: its page is /cable-test-van
# (src/lib/products.ts productHref). The page itself has bespoke sections (what's on board,
# cabin callouts, rear doors, call-out sequence, FAQ): see design/mockups/cable-test-van.html.
# A showcase, not quotable (src/data/quotable.ts): no Add to quote, and a contact band in place
# of the quote band.
model: Cable test van
name: Vehicle-mounted cable fault locating system
slug: cable-test-van
family: system
order: 7
description: Reflectometer, surge generator, acoustic receiver and route tracer on board, wired to a control panel and to a high-voltage connection panel at the rear doors. The crew arrives ready to measure.

keyFiguresLayout: text
keyFigures:
  - { label: Steps covered, value: 1 to 4 }
  - { label: Instrument models, slot: to confirm }
  - { label: Base vehicle, slot: to confirm }
  - { label: HV output, slot: to confirm }
tileFiguresLayout: rows
tileFigures:
  - { label: Steps covered, value: 1 to 4 }
  - { label: On board, value: "Reflectometer, surge generator, acoustic receiver, route tracer" }
  - { label: Base vehicle, slot: to confirm }

# Gallery order (the "Photos" section). The page also picks three of them by file name for its
# own sections: van-exterior (hero, OG image), van-interior (cabin callouts), van-rear (rear doors).
images:
  - src: ../../assets/img/van-exterior.jpg
    alt: "The HV Discover cable test van: a white high-roof van with ‘HV Cable Test Van’ on its side, seen from the front left."
    caption: Front three-quarter view.
    thumbLabel: front
  - src: ../../assets/img/van-side-door.jpg
    alt: "Cable test van from the front right with the sliding side door open, showing the step and the fitted interior."
    caption: Sliding side door open.
    thumbLabel: side door
  - src: ../../assets/img/van-profile.jpg
    alt: "Side profile of the white high-roof cable test van."
    caption: Side profile.
    thumbLabel: profile
  - src: ../../assets/img/van-rear-quarter.jpg
    alt: "Rear three-quarter view of the cable test van with its rear doors closed."
    caption: Rear three-quarter view.
    thumbLabel: rear quarter
  - src: ../../assets/img/van-rear.jpg
    alt: "The van from behind with both rear doors open: a connection panel with six terminals, cable reels in red and orange, a unit inside a mesh guard, and black instrument cases."
    caption: Rear doors open. Terminal labels as photographed.
    thumbLabel: rear doors open
  - src: ../../assets/img/van-interior.jpg
    alt: "Inside the van: an instrument bench with an aluminium-cased instrument and two orange instrument cases, a control panel with meters and lamps, a UPS below it, and a pull-out drawer holding a hand-held receiver and headphones."
    caption: "Instrument bench, control panel and UPS."
    thumbLabel: instrument bench
  - src: ../../assets/img/van-cabin.jpg
    alt: "Inside the test van looking towards the workbench, with instruments, a control panel, the roof hatch and an open drawer holding a locator."
    caption: Workbench, control panel and roof hatch.
    thumbLabel: cabin
tileAlt: "The cable test van from the front left: white high-roof van with the HV Discover name on its side."

datasheet: null

specsSource: Equipment as photographed. Models, ratings and most vehicle details are still to confirm.
specs:
  - group: Vehicle
    rows:
      - { label: Base vehicle, slot: to confirm }
      - { label: Body, value: "High-roof panel van, side windows, sliding side door, twin rear doors" }
      - { label: Crew seats, slot: to confirm }
  - group: Instruments
    rows:
      - { label: Reflectometer, slot: reflectometer model }
      - { label: Surge generator, value: With the HV connection panel at the rear doors, slot: surge generator model }
      - { label: Acoustic receiver, slot: acoustic receiver model }
      - { label: Route tracer, value: Transmitter and receiver, slot: route tracer model }
      - { label: Control panel, value: "Two meters; lamps for main, standby, surge, ARM, BT and 80 kV, as labelled" }
  - group: Power
    rows:
      - { label: Supply on board, slot: to confirm }
      - { label: UPS, value: "Rack-mounted under the control panel, rating", slot: to confirm }
      - { label: External mains connection, slot: to confirm }
  - group: High voltage
    rows:
      - { label: HV output, slot: to confirm }
      - { label: Rear panel terminals, value: "TDR, FLS, BT, ~H.V 40 kV~, ~H.V 80 kV~, Earth, as labelled" }
      - { label: Cable reels, value: "Four, at the rear doors. Lengths", slot: to confirm }
  - group: Cabin
    rows:
      - { label: Instrument bench, value: "Cooling fans in the front, pull-out drawer for the hand-held instruments" }
      - { label: Lighting, value: LED roof light }
      - { label: Safety, value: "Fire extinguisher bracket, electric shock warning sign" }
      - { label: Hand wash, value: Water dispenser at the bench }

worksWith: []

contactBand:
  heading: Talk to us about the van.
  lead: Questions about the equipment on board, the vehicle or how a crew works from it. We reply by email.

seo:
  title: "Cable test van: a fitted fault location system"
  description: "The HV Discover cable test van carries every step of cable fault location, fitted and wired: reflectometer, surge generator, acoustic receiver and route tracer."
---
