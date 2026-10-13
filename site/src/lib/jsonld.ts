/**
 * schema.org JSON-LD builders. Pages pass the results to BaseLayout's `jsonLd` prop, which
 * renders each object as its own <script type="application/ld+json">.
 * Instruments are quote-only: no `offers`, prices or availability. The cable test van is a
 * showcase, not a product for sale on the site, so its page is a `WebPage` (showcaseJsonLd).
 */
import { getImage } from 'astro:assets';
import { SITE } from '../data/site';
import { productHref, type Product } from './products';
import { organizationRef } from './structured-data';

type JsonLd = Record<string, unknown>;

/** "TDR-901 time domain reflectometer": the page title without the site name. */
export function productTitle(product: Product): string {
  const d = product.data;
  return d.seo?.title ?? `${d.model} ${d.name.charAt(0).toLowerCase()}${d.name.slice(1)}`;
}

/** Absolute URL on the production origin. */
export function absUrl(path: string): string {
  return new URL(path, SITE.url).href;
}

/** BreadcrumbList from [name, path] pairs, first one the home page. */
export function breadcrumbList(items: { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absUrl(item.path),
    })),
  };
}

/** ItemList of product pages, in the order given (the catalog). */
export function productItemList(products: Product[], name: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: productTitle(p),
      url: absUrl(productHref(p)),
    })),
  };
}

/** At most this many photos per page in JSON-LD `image`, in gallery order (the first is the lead). */
const MAX_LD_IMAGES = 5;

/** Absolute URLs of the first MAX_LD_IMAGES product photos as 1200 px JPGs. */
async function photoUrls(product: Product): Promise<string[]> {
  return Promise.all(
    product.data.images
      .slice(0, MAX_LD_IMAGES)
      .map(async (img) => absUrl((await getImage({ src: img.src, width: 1200, format: 'jpg' })).src)),
  );
}

/** Product: name, model, description, photos (1200 px JPG), brand. */
export async function productJsonLd(product: Product, category: string): Promise<JsonLd> {
  const d = product.data;
  const images = await photoUrls(product);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: productTitle(product),
    model: d.model,
    description: d.description,
    url: absUrl(productHref(product)),
    category,
    ...(images.length > 0 && { image: images }),
    brand: { '@type': 'Brand', name: SITE.name },
  };
}

/**
 * WebPage for a showcase page (the cable test van): what the page is about and its photos,
 * with no Product and no offers, since the van cannot be quoted or bought on the site.
 */
export async function showcaseJsonLd(product: Product): Promise<JsonLd> {
  const d = product.data;
  const images = await photoUrls(product);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: productTitle(product),
    description: d.seo?.description ?? d.description,
    url: absUrl(productHref(product)),
    inLanguage: 'en-GB',
    ...(images[0] && { primaryImageOfPage: { '@type': 'ImageObject', url: images[0] } }),
    ...(images.length > 0 && { image: images }),
    publisher: organizationRef(),
  };
}
