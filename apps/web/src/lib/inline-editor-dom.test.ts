import { describe, expect, it } from 'vitest';
import { composeMessageBody } from '@techpioasset/domain';
import { editorImageKeys, readEditor, type NodeLike } from './inline-editor-dom';

/** A hand-built DOM, shaped the way Chrome and Firefox shape a contenteditable. */
function el(tagName: string, children: NodeLike[] = [], attrs: Record<string, string> = {}): NodeLike {
  const node: NodeLike & { childNodes: NodeLike[] } = {
    nodeType: 1,
    tagName,
    textContent: null,
    getAttribute: (name) => attrs[name] ?? null,
    parentElement: null,
    nextSibling: null,
    childNodes: children,
  };
  children.forEach((child, i) => {
    child.parentElement = node;
    child.nextSibling = children[i + 1] ?? null;
  });
  return node;
}
const text = (t: string): NodeLike => ({ nodeType: 3, textContent: t, childNodes: [] });
const br = () => el('BR');
const image = (key: string) => el('SPAN', [el('IMG'), text('caption'), el('BUTTON', [text('×')])], { 'data-image-key': key });

describe('reading the inline editor', () => {
  it('plain text is one part; non-breaking spaces become spaces', () => {
    expect(readEditor(el('DIV', [text(`a${String.fromCharCode(160)}b`)]))).toEqual([{ kind: 'text', text: 'a b' }]);
    expect(readEditor(el('DIV'))).toEqual([]);
  });

  it('a picture node is a picture, whatever is inside it', () => {
    expect(readEditor(el('DIV', [text('Front '), image('k1'), text(' side')]))).toEqual([
      { kind: 'text', text: 'Front ' },
      { kind: 'image', key: 'k1' },
      { kind: 'text', text: ' side' },
    ]);
  });

  it('reads the line breaks the browser writes for Enter, without doubling them', () => {
    // Chrome: "a", Enter, "b"  ->  a<div>b</div>
    expect(readEditor(el('DIV', [text('a'), el('DIV', [text('b')])]))).toEqual([{ kind: 'text', text: 'a\nb' }]);
    // Chrome: "a", Enter, Enter, "b"  ->  a<div><br></div><div>b</div>
    expect(readEditor(el('DIV', [text('a'), el('DIV', [br()]), el('DIV', [text('b')])]))).toEqual([
      { kind: 'text', text: 'a\n\nb' },
    ]);
    // Firefox: "a", Enter, "b"  ->  a<br>b
    expect(readEditor(el('DIV', [text('a'), br(), text('b')]))).toEqual([{ kind: 'text', text: 'a\nb' }]);
    // Every line in its own div
    expect(readEditor(el('DIV', [el('DIV', [text('a')]), el('DIV', [text('b')])]))).toEqual([
      { kind: 'text', text: 'a\nb' },
    ]);
    // An empty first line, then "b"
    expect(readEditor(el('DIV', [el('DIV', [br()]), el('DIV', [text('b')])]))).toEqual([{ kind: 'text', text: '\nb' }]);
    // A trailing empty line the caret sits on
    expect(readEditor(el('DIV', [text('a'), el('DIV', [br()])]))).toEqual([{ kind: 'text', text: 'a\n' }]);
    // A block opening straight inside another is the same line
    expect(readEditor(el('DIV', [text('a'), el('DIV', [el('DIV', [text('b')])])]))).toEqual([
      { kind: 'text', text: 'a\nb' },
    ]);
    // A picture on its own line between two lines of text
    expect(readEditor(el('DIV', [el('DIV', [text('a')]), el('DIV', [image('k1')]), el('DIV', [text('b')])]))).toEqual([
      { kind: 'text', text: 'a\n' },
      { kind: 'image', key: 'k1' },
      { kind: 'text', text: '\nb' },
    ]);
  });

  it('pasted formatting is transparent: only the words survive', () => {
    const pasted = el('DIV', [el('B', [text('bold')]), text(' and '), el('A', [text('a link')], { href: 'http://x' }), el('SCRIPT', [text('alert(1)')])]);
    expect(readEditor(pasted)).toEqual([{ kind: 'text', text: 'bold and a linkalert(1)' }]);
  });

  it('lists picture keys by appearance, once each, and composes the outgoing tokens from them', () => {
    const parts = readEditor(el('DIV', [image('kB'), text('\n'), image('kA'), text('end'), image('kB')]));
    const keys = editorImageKeys(parts);
    expect(keys).toEqual(['kB', 'kA']);
    expect(composeMessageBody(parts, keys)).toBe('![image 1](pending:1)\n![image 2](pending:2)end![image 1](pending:1)');
  });
});
