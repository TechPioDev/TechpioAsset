/**
 * Which icon stands for a piece of equipment (U3).
 *
 * Every asset row in the app drew the same chip icon, so a list of sixty
 * things was sixty identical squares and the only way to tell a laptop from a
 * chair was to read. The list already carries the category and subcategory
 * names, so the icon can say what the thing is without a single extra byte
 * from the server - the asset list query deliberately does not fetch photos
 * (one join per row on every list), and this is the honest substitute.
 *
 * Matching is on words, not substrings. "Monitor" must not match "monitoring
 * subscription", and a category named "Chair" must not be found inside
 * "Chairman's desk".
 */

/** Ionicons names, kept as plain strings so this file stays free of React. */
export type AssetIconName =
  | 'laptop-outline'
  | 'desktop-outline'
  | 'phone-portrait-outline'
  | 'tablet-portrait-outline'
  | 'tv-outline'
  | 'headset-outline'
  | 'keypad-outline'
  | 'print-outline'
  | 'server-outline'
  | 'wifi-outline'
  | 'videocam-outline'
  | 'car-outline'
  | 'cafe-outline'
  | 'bed-outline'
  | 'construct-outline'
  | 'cube-outline'
  | 'layers-outline'
  | 'battery-charging-outline'
  | 'hardware-chip-outline';

/**
 * Ordered, because the first match wins and some words belong to more than
 * one family: a "laptop docking station" is a dock, not a laptop, so the
 * more specific words come first.
 */
const RULES: { icon: AssetIconName; words: string[] }[] = [
  { icon: 'keypad-outline', words: ['dock', 'docking', 'keyboard', 'mouse', 'hub', 'adapter'] },
  { icon: 'headset-outline', words: ['headset', 'headphone', 'headphones', 'earphone', 'earbuds', 'audio'] },
  { icon: 'tv-outline', words: ['monitor', 'monitors', 'display', 'screen', 'projector', 'television'] },
  { icon: 'laptop-outline', words: ['laptop', 'laptops', 'notebook', 'macbook', 'ultrabook'] },
  { icon: 'desktop-outline', words: ['desktop', 'desktops', 'workstation', 'pc', 'imac', 'cpu'] },
  { icon: 'tablet-portrait-outline', words: ['tablet', 'tablets', 'ipad'] },
  { icon: 'phone-portrait-outline', words: ['phone', 'phones', 'mobile', 'handset', 'iphone', 'smartphone'] },
  { icon: 'print-outline', words: ['printer', 'printers', 'scanner', 'copier', 'plotter'] },
  { icon: 'server-outline', words: ['server', 'servers', 'nas', 'storage', 'rack'] },
  { icon: 'wifi-outline', words: ['router', 'switch', 'firewall', 'access', 'network', 'modem'] },
  { icon: 'videocam-outline', words: ['camera', 'cameras', 'webcam', 'cctv'] },
  { icon: 'battery-charging-outline', words: ['ups', 'battery', 'charger', 'powerbank'] },
  { icon: 'car-outline', words: ['vehicle', 'vehicles', 'car', 'bike', 'van'] },
  { icon: 'cafe-outline', words: ['kitchen', 'appliance', 'appliances', 'microwave', 'fridge', 'coffee'] },
  // Beds only. Ionicons has no chair or desk, and putting a bed on an office
  // chair is the icon saying something confidently wrong - worse than saying
  // nothing. Furniture gets the neutral mark below instead.
  { icon: 'bed-outline', words: ['bed', 'mattress', 'bunk'] },
  { icon: 'cube-outline', words: ['furniture', 'chair', 'desk', 'table', 'cabinet', 'sofa', 'stool', 'shelf'] },
  // Deliberately NOT 'equipment': the commonest category in the data is
  // "IT Equipment", so that word would put a wrench on every asset whose
  // subcategory happened to match nothing.
  { icon: 'construct-outline', words: ['tool', 'machinery', 'drill', 'ladder'] },
  { icon: 'layers-outline', words: ['consumable', 'stationery', 'supplies', 'stock', 'cartridge'] },
];

/** The fallback: a generic piece of hardware, which is what it always was. */
export const DEFAULT_ASSET_ICON: AssetIconName = 'hardware-chip-outline';

/**
 * The words in a label, each also offered in its singular form, so the rules
 * below do not have to list "headset" and "headsets" and "headsets/earbuds".
 * Still whole words: de-pluralising is not the same as substring matching.
 */
function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w) continue;
    out.add(w);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  }
  return out;
}

/**
 * Subcategory first: it is the more specific of the two, so "IT Equipment /
 * Headsets" is a headset rather than a generic chip.
 */
export function assetIcon(
  category?: string | null,
  subcategory?: string | null,
  name?: string | null,
): AssetIconName {
  for (const text of [subcategory, category, name]) {
    if (!text) continue;
    const found = words(text);
    for (const rule of RULES) {
      if (rule.words.some((w) => found.has(w))) return rule.icon;
    }
  }
  return DEFAULT_ASSET_ICON;
}
