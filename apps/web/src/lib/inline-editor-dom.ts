/**
 * Reading the inline-image editor's DOM back into text and pictures (v2.61).
 * Written over the smallest node shape it needs so it can be tested without a
 * browser: only text, line breaks and our own picture nodes are recognised;
 * every other element is transparent (its children are read, it is not).
 */

export const IMAGE_KEY_ATTR = 'data-image-key';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
/** Browsers write a non-breaking space for a typed space beside a break; people mean a space. */
const NBSP = new RegExp(String.fromCharCode(160), 'g');
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

export interface NodeLike {
  nodeType: number;
  textContent: string | null;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  parentElement?: NodeLike | null;
  nextSibling?: NodeLike | null;
  childNodes: ArrayLike<NodeLike> & Iterable<NodeLike>;
}

export type EditorPart = { kind: 'text'; text: string } | { kind: 'image'; key: string };

/** What is in the box, in reading order: text with line breaks, and picture keys. */
export function readEditor(root: NodeLike): EditorPart[] {
  const parts: EditorPart[] = [];
  // Browsers write a line as a block (<div>..</div>) once Enter has been
  // pressed. A block starts a new line when anything came before it - except
  // a block opening directly inside another, which is the same line.
  let started = false;
  let justOpenedBlock = false;
  const push = (text: string) => {
    if (text.length === 0) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === 'text') last.text += text;
    else parts.push({ kind: 'text', text });
  };
  const content = () => {
    started = true;
    justOpenedBlock = false;
  };
  const walk = (node: NodeLike) => {
    if (node.nodeType === TEXT_NODE) {
      content();
      push((node.textContent ?? '').replace(NBSP, ' '));
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const key = node.getAttribute?.(IMAGE_KEY_ATTR);
    if (key) {
      content();
      parts.push({ kind: 'image', key });
      return;
    }
    if (node.tagName === 'BR') {
      // A <br> that closes a block is the browser's placeholder for an empty
      // line, not a break the person typed.
      const parent = node.parentElement;
      const closesBlock =
        parent != null && parent !== root && BLOCK_TAGS.has(parent.tagName ?? '') && node.nextSibling == null;
      content();
      if (!closesBlock) push('\n');
      return;
    }
    if (BLOCK_TAGS.has(node.tagName ?? '')) {
      if (started && !justOpenedBlock) push('\n');
      started = true;
      justOpenedBlock = true;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return parts;
}

/** The picture keys in reading order, each once. */
export function editorImageKeys(parts: readonly EditorPart[]): string[] {
  return parts.flatMap((p) => (p.kind === 'image' ? [p.key] : [])).filter((k, i, all) => all.indexOf(k) === i);
}
