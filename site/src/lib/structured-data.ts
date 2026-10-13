/**
 * schema.org builders for the BaseLayout `jsonLd` prop. Every URL is absolute and clean
 * (no .html, no trailing slash), matching the canonical tags.
 *   jsonLd={[breadcrumbs([{ name: 'Support', path: '/support' }])]}
 */
import { SITE } from '../data/site';

export interface Crumb {
  name: string;
  path: string;
}

const abs = (path: string): string => new URL(path, SITE.url).href;

/** BreadcrumbList for an inner page; Home is added as the first item. */
export function breadcrumbs(trail: Crumb[]): Record<string, unknown> {
  const items = [{ name: 'Home', path: '/' }, ...trail];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

/** The publisher reference used inside articles. */
export function organizationRef(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    logo: { '@type': 'ImageObject', url: abs('/favicon.svg') },
  };
}

/** FAQPage. Only pass questions whose answer is confirmed (no slot answers). */
export function faqPage(items: { q: string; a: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export { abs as absoluteUrl };
