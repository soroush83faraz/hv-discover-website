/**
 * Content collections. `products` is the single source of truth for the six instruments
 * and the cable test van: tiles, product pages, the workflow line, the footer and the
 * quote list all read from it. The van (family 'system') is a showcase and cannot be quoted. One Markdown file per product in src/content/products/;
 * the frontmatter holds the data below, the body holds the "Overview" paragraphs.
 *
 * Text fields marked "inline" go through src/lib/inline.ts and may use:
 *   {kV}           a unit, rendered as <span class="unit">kV</span>
 *   ~TDR-901~      no line break inside, rendered as <span class="nowrap">TDR-901</span>
 *   [label](/url)  a link
 * Everything else is escaped. A fact that is not confirmed is left out (never guessed). A `slot`
 * field still renders through Slot.astro as a dashed "[to confirm]" placeholder, but the build
 * fails on any placeholder left in dist/ (scripts/no-placeholders.mjs), so use it only while
 * drafting.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** A key figure or tile figure: "100 km", label "Range". */
const figure = z.object({
  label: z.string(),
  /** Display value: "100", "0–30", "1,800", or text such as "Arc reflection (ARM)". May be empty when only a slot is shown. */
  value: z.string().default(''),
  unit: z.string().optional(),
  /** Placeholder for an unconfirmed fact, without brackets: "to follow". */
  slot: z.string().optional(),
}).strict();

const specRow = z.object({
  label: z.string(),
  /** inline. Empty when the whole value is still a slot. */
  value: z.string().default(''),
  /** Appended after the value as <span class="unit">. Use {unit} inside `value` for several units. */
  unit: z.string().optional(),
  slot: z.string().optional(),
}).strict();

const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      /** Model as printed on the nameplate. For an instrument, also its quote-list id ("hvd-quote-list", src/data/quotable.ts). */
      model: z.string(),
      /** Product name under the model: "Time domain reflectometer". */
      name: z.string(),
      /** URL slug: /products/<slug>. The van's slug is "cable-test-van" and it lives at /cable-test-van. */
      slug: z.string(),
      /** Workflow step 1–4, or 'system' for the van. Family names live in src/data/families.ts. */
      family: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('system')]),
      /** Sort order in tiles, footer and catalog. */
      order: z.number(),
      /** Short noun for footer links: "TDR-901 reflectometer". Omit to show the model only. */
      shortName: z.string().optional(),
      /** One-sentence description: the product lede and the meta description. */
      description: z.string(),

      /** Key figures beside the nameplate on the product page (4). */
      keyFigures: z.array(figure),
      /** 'numeric': value + unit figures; 'text': text facts (keyfigs--text). */
      keyFiguresLayout: z.enum(['numeric', 'text']).default('numeric'),
      /** Figures on the nameplate tile (2–3). */
      tileFigures: z.array(figure),
      /** 'figs': three numeric figures side by side; 'rows': label | value rows (figs--rows). */
      tileFiguresLayout: z.enum(['figs', 'rows']).default('figs'),

      /** Photos, first one is the lead image (tile, gallery start). Empty for products without photos. */
      images: z
        .array(
          z.object({
            src: image(),
            alt: z.string(),
            /** Gallery caption under the stage. */
            caption: z.string().optional(),
            /** Visually hidden thumbnail label: "in its case" → "Photo 1 of 2: in its case". */
            thumbLabel: z.string().optional(),
          }),
        )
        .default([]),
      /** Alt text for the tile image, when it should differ from images[0].alt. */
      tileAlt: z.string().optional(),
      /** Technical line drawing used until a photo exists (PlaceholderDrawing.astro). */
      drawing: z.enum(['pg-10', 'crt-015']).nullable().default(null),
      /** Accessible description of the drawing. */
      drawingAlt: z.string().optional(),

      /** Datasheet link, or null when there is none (the page then shows no datasheet line). */
      datasheet: z
        .object({
          url: z.string(),
          note: z.string().optional(),
        })
        .nullable()
        .default(null),

      /**
       * Key features (plain text, short lines) and a one-line applications statement. Printed
       * only on the English datasheet PDF, which ../tools/make_datasheets.py builds from this
       * file, so the PDF and the product page share one source.
       */
      features: z.array(z.string()).default([]),
      applications: z.string().optional(),

      /** Lead paragraph of "Where it fits" on the product page. */
      fitLead: z.string().optional(),

      /** Line under the "Specifications" heading: where the values come from. */
      specsSource: z.string().optional(),
      specs: z
        .array(
          z.object({
            group: z.string(),
            rows: z.array(specRow),
          }),
        )
        .default([]),
      /** Note under the spec tables (inline). */
      specsNote: z.object({ text: z.string() }).strict().optional(),

      /** "In the box" list. qty is shown right-aligned when known. */
      inTheBox: z.array(z.object({ item: z.string(), qty: z.string().optional() })).default([]),
      /** Line under the "In the box" heading. */
      inTheBoxNote: z.string().optional(),
      /** Photo beside the list: index into `images`, its own alt and a caption. */
      inTheBoxFigure: z
        .object({
          image: z.number().int().min(0),
          alt: z.string(),
          caption: z.string(),
        })
        .strict()
        .optional(),

      /** Slugs of the products shown under "Works with" (the van is "cable-test-van"). */
      worksWith: z.array(z.string()).default([]),
      worksWithLead: z.string().optional(),

      /**
       * Closing quote band of an instrument page (required for instruments, not allowed for the
       * van). heading is inline (use ~MODEL~ to keep the model on one line).
       */
      quoteBand: z.object({ heading: z.string(), lead: z.string() }).optional(),
      /** The van's closing band: a contact call to action, since the van is not quotable (required for the van only). */
      contactBand: z.object({ heading: z.string(), lead: z.string() }).optional(),

      /**
       * <title> (without "| HV Discover") and meta description of the product page, when they
       * should differ from "<model> <name>" and `description` (the lede).
       */
      seo: z.object({ title: z.string(), description: z.string() }).strict().optional(),

      /**
       * Bespoke section on the product page (src/components/product/):
       *   'arc-reflection'  "What arc reflection does": two traces and the schematic; sits where
       *                     the Overview would (ARM Filter).
       *   'surge-compare'   "PG-10 or PG-32?" comparison table, after the specifications (PG-10).
       */
      bespokeSection: z.enum(['arc-reflection', 'surge-compare']).optional(),
    })
      .strict()
      .superRefine((d, ctx) => {
        const van = d.family === 'system';
        if (van && (d.quoteBand || !d.contactBand)) {
          ctx.addIssue({ code: 'custom', message: 'The van is not quotable: give it contactBand, not quoteBand.' });
        }
        if (!van && (!d.quoteBand || d.contactBand)) {
          ctx.addIssue({ code: 'custom', message: 'An instrument needs quoteBand (and no contactBand).' });
        }
      }),
});

export const collections = { products };
