/**
 * Helpers around the products collection (src/content/products, schema in
 * src/content.config.ts). Pages and components get products from here, never by
 * hard-coding names, figures or URLs.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { getImage } from 'astro:assets';
import { getFamily } from '../data/families';
import { QUOTABLE_MODELS } from '../data/quotable';

export type Product = CollectionEntry<'products'>;

/** All seven entries (the six instruments and the van showcase), in `order`. */
export async function getProducts(): Promise<Product[]> {
  const all = await getCollection('products');
  return all.sort((a, b) => a.data.order - b.data.order);
}

/** The six instruments, without the van: the products that can be quoted. */
export async function getInstruments(): Promise<Product[]> {
  return (await getProducts()).filter((p) => p.data.family !== 'system');
}

export async function getProduct(slug: string): Promise<Product> {
  const product = (await getProducts()).find((p) => p.data.slug === slug);
  if (!product) throw new Error(`Unknown product slug: ${slug}`);
  return product;
}

/** Products by slug, in the order given (e.g. a product's `worksWith`). */
export async function getProductsBySlugs(slugs: string[]): Promise<Product[]> {
  return Promise.all(slugs.map((slug) => getProduct(slug)));
}

/**
 * Whether the product can go on the quote list. Only the instruments can: the cable test van
 * is a showcase (no "Add to quote", no quote band), and the API refuses it.
 */
export function isQuotable(product: Product): boolean {
  return product.data.family !== 'system';
}

/** Clean URL of the product page. The van lives at /cable-test-van. */
export function productHref(product: Product): string {
  return product.data.family === 'system' ? '/cable-test-van' : `/products/${product.data.slug}`;
}

/** "Step 1, pre-locate", "Steps 1 to 4, integrated": the small label on tiles. */
export function tileStep(product: Product): string {
  return getFamily(product.data.family).tileStep;
}

/** mailto: link for "Ask a question". */
export function askHref(product: Product, email = 'info@hvdiscover.com'): string {
  const what = product.data.family === 'system' ? product.data.model.toLowerCase() : product.data.model;
  return `mailto:${email}?subject=${encodeURIComponent(`Question about the ${what}`)}`;
}

/** Footer link label: "TDR-901 reflectometer". */
export function shortLabel(product: Product): string {
  return product.data.shortName ? `${product.data.model} ${product.data.shortName}` : product.data.model;
}

/**
 * Data for the client-side quote list (src/scripts/quote.ts): one entry per quotable product
 * (the six instruments, never the van) with its quote id (= model), names, URL and a small
 * image or drawing. Serialise it into the page as <script type="application/json" id="quote-catalog">.
 */
export interface QuoteCatalogItem {
  id: string;
  name: string;
  step: string;
  href: string;
  img?: { src: string; srcset: string };
  drawing?: 'pg-10' | 'crt-015';
}

export async function getQuoteCatalog(): Promise<QuoteCatalogItem[]> {
  const products = (await getProducts()).filter(isQuotable);
  const ids = products.map((p) => p.data.model);
  if (ids.length !== QUOTABLE_MODELS.length || ids.some((id) => !QUOTABLE_MODELS.includes(id))) {
    throw new Error(
      `Quotable products (${ids.join(', ')}) differ from QUOTABLE_MODELS in src/data/quotable.ts ` +
        `(${QUOTABLE_MODELS.join(', ')}). Keep both in step with the API list (../api/CLIENT.md).`,
    );
  }
  return Promise.all(
    products.map(async (p) => {
      const item: QuoteCatalogItem = {
        id: p.data.model,
        name: p.data.name,
        step: tileStep(p),
        href: productHref(p),
      };
      const lead = p.data.images[0];
      if (lead) {
        const img = await getImage({ src: lead.src, widths: [480, 800], format: 'webp' });
        item.img = { src: img.src, srcset: img.srcSet.attribute };
      } else if (p.data.drawing) {
        item.drawing = p.data.drawing;
      }
      return item;
    }),
  );
}
