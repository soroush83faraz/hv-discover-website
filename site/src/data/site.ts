/**
 * Site-wide constants: contact details and navigation.
 * Every link uses the clean URL (no .html, no trailing slash): see astro.config.mjs.
 */

export const SITE = {
  name: 'HV Discover',
  url: 'https://hvdiscover.com',
  email: 'info@hvdiscover.com',
  /**
   * Only London, United Kingdom is confirmed. The company name and a UK phone number are still
   * to confirm: pages show them as Slot placeholders. Structured data and meta tags carry
   * city and country only (never the street below).
   */
  city: 'London',
  country: 'United Kingdom',
  /** ISO 3166-1 code for JSON-LD addressCountry. */
  countryCode: 'GB',
  /**
   * PLACEHOLDER address and hours chosen by the assistant at the owner's request on 2026-10-12.
   * Not a real address. Replace before launch.
   * This is the one place they live: the footer, contact, about and privacy pages and the
   * mobile menu all read these two constants.
   */
  address: ['Unit 4, Meridian Works', 'Hackney Road', 'London E2, United Kingdom'],
  hours: 'Monday to Friday, 09:00 to 17:30, UK time',
  tagline:
    'Cable fault location instruments, from the first pulse to the dig spot, and the van that carries them.',
} as const;

export interface NavLink {
  href: string;
  label: string;
  /** Small second line in the mobile menu sheet. */
  micro?: string;
}

/** Desktop main nav and the mobile menu sheet (which adds Contact at the end). */
export const MAIN_NAV: NavLink[] = [
  { href: '/products', label: 'Products', micro: '6 instruments' },
  { href: '/fault-location', label: 'Fault location', micro: 'The method' },
  { href: '/cable-test-van', label: 'Cable test van' },
  { href: '/support', label: 'Support' },
  { href: '/about', label: 'About' },
];

export const CONTACT_LINK: NavLink = { href: '/contact', label: 'Contact' };

/** Footer "Company" column. The "Products" column is built from the products collection. */
export const FOOTER_COMPANY: NavLink[] = [
  { href: '/fault-location', label: 'Fault location' },
  { href: '/cable-test-van', label: 'Cable test van' },
  { href: '/support', label: 'Support' },
  { href: '/about', label: 'About' },
  { href: '/request-a-quote', label: 'Request a quote' },
  { href: '/privacy', label: 'Privacy' },
];
