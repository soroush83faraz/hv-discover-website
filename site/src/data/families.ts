/**
 * The fault-location workflow (docs/05-decisions.md): four numbered steps plus the
 * integrated system. Products point at a family with `family: 1 | 2 | 3 | 4 | 'system'`.
 */

export type FamilyStep = 1 | 2 | 3 | 4 | 'system';

export interface Family {
  step: FamilyStep;
  /** Anchor / filter id on /products, e.g. /products#pre-location */
  id: string;
  /** Family name: "Pre-location" */
  name: string;
  /** Station title on the workflow line: "Pre-locate" */
  verb: string;
  /** Small label above a nameplate tile: "Step 1, pre-locate" */
  tileStep: string;
  /** One-line task under the family name on /products */
  task: string;
  /** What happens in this step (workflow line, catalog family head) */
  text: string;
  /** Accessible name of the family line diagram (FamilyDiagram.astro) */
  diagramLabel: string;
}

export const FAMILIES: Family[] = [
  {
    step: 1,
    id: 'pre-location',
    name: 'Pre-location',
    verb: 'Pre-locate',
    tileStep: 'Step 1, pre-locate',
    task: 'Measure the distance to the fault.',
    text: 'A low-voltage pulse goes into the cable. The time its reflection takes to come back gives the distance to the fault.',
    diagramLabel: 'Diagram: a TDR trace with a launch pulse and a reflection from the fault',
  },
  {
    step: 2,
    id: 'surge-conditioning',
    name: 'Surge & conditioning',
    verb: 'Condition',
    tileStep: 'Step 2, condition',
    task: 'Break the fault down so it can be found.',
    text: 'A high-voltage surge breaks down high-resistance and intermittent faults, so they reflect clearly and flash over audibly.',
    diagramLabel: 'Diagram: repeated surge impulses, a sharp rise and a slow decay',
  },
  {
    step: 3,
    id: 'pinpointing',
    name: 'Pinpointing',
    verb: 'Pinpoint',
    tileStep: 'Step 3, pinpoint',
    task: 'Find the exact spot to dig.',
    text: 'Walk the route while the surge generator fires and listen for the discharge through the ground. The loudest point is where you dig.',
    diagramLabel: 'Diagram: sound waves rising from a fault in a buried cable to a sensor on the ground',
  },
  {
    step: 4,
    id: 'route-tracing',
    name: 'Route tracing',
    verb: 'Trace route',
    tileStep: 'Step 4, trace route',
    task: 'Follow the cable path.',
    text: 'A transmitter puts a signal on the cable and a receiver follows it, so the measured distance lands on the right street.',
    diagramLabel: 'Diagram: a cable route followed along a street grid',
  },
  {
    step: 'system',
    id: 'integrated-system',
    name: 'Integrated system',
    verb: 'Steps 1 to 4',
    tileStep: 'Steps 1 to 4, integrated',
    task: 'All four steps, fitted in one vehicle.',
    text: 'Reflectometer, surge generator, pinpointer and route tracer, wired in and ready when the van arrives.',
    diagramLabel: 'Diagram: one cable line with four stations and the dig spot at its end',
  },
];

/** The four numbered steps, in order (no integrated system). */
export const WORKFLOW_STEPS = FAMILIES.filter((f) => f.step !== 'system');

export function getFamily(step: FamilyStep): Family {
  const family = FAMILIES.find((f) => f.step === step);
  if (!family) throw new Error(`Unknown family step: ${String(step)}`);
  return family;
}
