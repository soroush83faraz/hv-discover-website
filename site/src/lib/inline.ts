/**
 * Inline formatting for short text fields in the products collection (spec values,
 * quote band headings). The input is escaped first, then three tokens are expanded:
 *
 *   {kV}           → <span class="unit">kV</span>
 *   ~TDR-901~      → <span class="nowrap">TDR-901</span>
 *   [label](/url)  → <a href="/url">label</a>
 *
 * Render the result with <Fragment set:html={inline(text)} />.
 */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\{([^}]+)\}/g, '<span class="unit">$1</span>')
    .replace(/~([^~]+)~/g, '<span class="nowrap">$1</span>');
}
