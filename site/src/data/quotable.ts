/**
 * The product models a visitor can put on the quote list: the six instruments, by their
 * `model` (the quote-list id). It must equal the form API's list (HVD_PRODUCTS in
 * ../api/lib/forms.php, see ../api/CLIENT.md), which refuses any other id.
 *
 * The cable test van is a showcase, not quotable: it has no "Add to quote" anywhere.
 * getQuoteCatalog() (src/lib/products.ts) fails the build if the products collection and this
 * list disagree; lib/quote-store.ts drops any other id from a list saved in a browser.
 */
export const QUOTABLE_MODELS: readonly string[] = ['TDR-901', 'ARM Filter', 'PG-10', 'PG-32', 'AP-01', 'CRT-015'];

export function isQuotableModel(id: string): boolean {
  return QUOTABLE_MODELS.includes(id);
}
