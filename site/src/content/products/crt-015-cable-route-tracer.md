---
model: CRT-015
name: Cable route tracer
slug: crt-015-cable-route-tracer
family: 4
order: 6
shortName: route tracer
description: Transmitter and receiver that follow a buried cable from the surface, so the measured distance is walked along the real route.

keyFiguresLayout: text
keyFigures:
  - { label: Set, value: Transmitter and receiver }
  - { label: Finds, value: The route of a buried cable }
  - { label: Used, value: Before pinpointing }
  - { label: Works with, value: TDR-901 and AP-01 }
tileFiguresLayout: rows
tileFigures:
  - { label: Set, value: Receiver and transmitter }
  - { label: Works with, value: "TDR-901, AP-01" }

# Low-resolution source (622 x 682 px of product, placed at 1:1 on the 1600 x 1200 white canvas,
# never enlarged): it looks smaller and softer than the other photos. The drawing below is the
# fallback and shows again if `images` is emptied.
images:
  - src: ../../assets/img/crt-015.jpg
    alt: "Cable route tracer set: a curved locator receiver with a small display, and a portable transmitter with keypad and carry handle."
    caption: Locator receiver and transmitter.
    thumbLabel: set
drawing: crt-015
drawingAlt: "Line drawing of the CRT-015 set: a long hand-held receiver with a display, and a portable transmitter with a handle and keypad."

datasheet: null

fitLead: The CRT-015 is step 4. It puts the measured distance on the right street.

# No spec table: no transmitter, receiver, battery or size figure is confirmed yet
# (docs/04-owner-questions.md H). The Overview carries the page.
worksWith: [tdr-901-time-domain-reflectometer, ap-01-acoustic-pinpointer]
worksWithLead: The CRT-015 turns the TDR-901’s distance into a line on the ground, and the AP-01 then walks that line.

quoteBand:
  heading: Price a ~CRT-015~ with your set.
  lead: Tell us the cable lengths you trace, and whether you need the TDR-901 and AP-01 with it.

seo:
  title: "CRT-015 cable route tracer"
  description: "CRT-015: transmitter and receiver set that traces the route of a buried power cable, so the measured fault distance is walked along the real cable path."
---

A reflectometer measures distance along the cable, not along the street. Cables bend, cross roads and change sides, so a fault 1,284 m from the cable end can be well away from where a tape along the kerb would put it.

The CRT-015 transmitter puts a signal on the cable. The receiver picks it up at the surface, and the crew follows it and marks the route. The pinpointer is then walked along that line instead of across the whole street.
