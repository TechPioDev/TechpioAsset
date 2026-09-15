/**
 * Text made safe to drop into an HTML document.
 *
 * The phone prints through the system print dialog, which renders an HTML
 * string. Most of what goes into that string was typed by someone - asset
 * names, accessories, people's names - and a laptop called `<img onerror=...>`
 * must print as those characters, not run. Every interpolated value goes
 * through here; the markup around it is the only unescaped text.
 */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);
}
