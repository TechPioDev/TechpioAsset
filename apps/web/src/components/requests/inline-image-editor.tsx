'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type HTMLAttributes,
} from 'react';
import { composeMessageBody, parseMessageBody } from '@techpioasset/domain';
import { clipboardImageFiles, imageFilesFrom, type PendingImage } from '@/lib/comment-images';
import { IMAGE_KEY_ATTR, editorImageKeys, readEditor } from '@/lib/inline-editor-dom';

/**
 * A message box that takes pictures between the words (v2.61), the way a mail
 * client does: "Add image", a drop, or a paste puts the picture where the
 * cursor is, and it can be deleted like a character or with its own control.
 *
 * It is a contenteditable with exactly three kinds of content - text, line
 * breaks and our own picture nodes - and nothing else survives serialising:
 * a paste is reduced to its plain text before it goes in, and the value
 * handed back is the token text (`![image N](pending:N)`, numbered by
 * reading order) that the API takes. No HTML is ever sent or stored.
 *
 * The DOM is owned here, not by React: React reconciling a contenteditable
 * fights the browser for the caret. The parent's value only rewrites the DOM
 * when it differs from what was last reported - in practice, when the parent
 * clears it after a send.
 */

export interface InlineImageEditorHandle {
  /** Queues the files (via onAddFiles) and puts the accepted ones at the cursor. */
  addFiles: (files: Iterable<File> | null | undefined) => void;
  focus: () => void;
}

export const DRAG_OVER_CLASS = 'outline outline-2 outline-dashed outline-[var(--color-brand)] outline-offset-4';

export const InlineImageEditor = forwardRef<
  InlineImageEditorHandle,
  {
    /** Token text; pictures numbered by their place in `images`. */
    value: string;
    images: PendingImage<File>[];
    previewFor: (key: string) => string | undefined;
    /** The text (tokens renumbered by reading order) and the pictures still in it, in that order. */
    onChange: (next: { text: string; keys: string[] }) => void;
    /** Queues files with the pending list and returns the accepted ones (the rest were explained in a toast). */
    onAddFiles: (files: File[]) => PendingImage<File>[];
    /** Said when something other than a picture is dropped. */
    onRejectedDrop?: () => void;
    placeholder?: string;
    disabled?: boolean;
    minRows?: number;
    // What a form control slot passes down (id, aria-describedby, aria-invalid) rides through.
  } & Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children' | 'placeholder'>
>(function InlineImageEditor(
  { value, images, previewFor, onChange, onAddFiles, onRejectedDrop, placeholder, disabled, minRows = 2, className, ...rest },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [empty, setEmpty] = useState(true);

  const imagesRef = useRef(images);
  imagesRef.current = images;
  // Read through refs so the handlers wired onto picture nodes (which outlive
  // any one render) always reach the current callbacks.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const previewForRef = useRef(previewFor);
  previewForRef.current = previewFor;

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const parts = readEditor(root);
    const keys = editorImageKeys(parts);
    const text = composeMessageBody(parts, keys);
    setEmpty(text.trim().length === 0);
    lastEmitted.current = text;
    onChangeRef.current({ text, keys });
  }, []);

  const imageNode = useCallback(
    (image: PendingImage<File>): HTMLElement => {
      const wrap = document.createElement('span');
      wrap.setAttribute(IMAGE_KEY_ATTR, image.key);
      wrap.contentEditable = 'false';
      wrap.draggable = false;
      wrap.className = 'group relative my-1 mr-1 inline-block max-w-full align-bottom';
      wrap.title = image.caption;

      const url = previewForRef.current(image.key);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = image.file.name;
        img.draggable = false;
        img.className =
          'block max-h-48 max-w-[320px] rounded-[var(--radius-control)] border border-[var(--color-border)] object-contain';
        wrap.append(img);
      } else {
        const box = document.createElement('span');
        box.className =
          'grid h-20 w-28 place-items-center rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] text-xs text-[var(--color-content-subtle)]';
        box.textContent = image.file.name;
        wrap.append(box);
      }

      const caption = document.createElement('span');
      caption.className = 'block max-w-[320px] truncate text-[11px] text-[var(--color-content-muted)]';
      caption.textContent = image.caption;
      wrap.append(caption);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${image.file.name}`);
      remove.textContent = '×';
      remove.className =
        'absolute -top-2 -right-2 hidden size-6 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm leading-none text-[var(--color-content-muted)] shadow-sm group-hover:grid group-focus-within:grid hover:text-[var(--tone-critical-fg)]';
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        wrap.remove();
        emit();
        rootRef.current?.focus();
      });
      wrap.append(remove);
      return wrap;
    },
    [emit],
  );

  /** Rebuilds the DOM from the token text - only when the parent changed it. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || value === lastEmitted.current) return;
    root.replaceChildren();
    for (const s of parseMessageBody(value)) {
      if (s.kind === 'text') {
        root.append(document.createTextNode(s.text));
      } else if (s.ref.kind === 'pending') {
        const image = imagesRef.current[s.ref.index - 1];
        if (image) root.append(imageNode(image));
      }
    }
    lastEmitted.current = value;
    setEmpty(value.trim().length === 0);
  }, [value, imageNode]);

  // The cursor is remembered so "Add image" (a click elsewhere) still knows
  // where the person was writing.
  useEffect(() => {
    const onSelection = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (root.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const insertAtCursor = useCallback(
    (nodes: Node[]) => {
      const root = rootRef.current;
      if (!root || nodes.length === 0) return;
      const sel = window.getSelection();
      let range: Range | null = null;
      if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        range = sel.getRangeAt(0);
      } else if (savedRange.current && root.contains(savedRange.current.commonAncestorContainer)) {
        range = savedRange.current;
      } else {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      range.deleteContents();
      for (const node of nodes) {
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRange.current = range.cloneRange();
      emit();
    },
    [emit],
  );

  const addFiles = useCallback(
    (files: Iterable<File> | null | undefined) => {
      if (disabled) return;
      const added = onAddFiles(Array.from(files ?? []));
      if (added.length > 0) insertAtCursor(added.map(imageNode));
    },
    [disabled, onAddFiles, imageNode, insertAtCursor],
  );

  useImperativeHandle(ref, () => ({ addFiles, focus: () => rootRef.current?.focus() }), [addFiles]);

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    const pictures = clipboardImageFiles(e.clipboardData.items);
    if (pictures.length > 0) {
      addFiles(pictures);
      return;
    }
    // Text only, and only as text: whatever it was formatted as stays behind.
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    if (!document.execCommand('insertText', false, text)) insertAtCursor([document.createTextNode(text)]);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    // Land where it was dropped, not where the cursor last was.
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let range: Range | null = null;
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(e.clientX, e.clientY);
    else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (range && rootRef.current?.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRange.current = range.cloneRange();
    }
    const files = Array.from(e.dataTransfer.files);
    const pictures = imageFilesFrom(files);
    if (pictures.length < files.length) onRejectedDrop?.();
    addFiles(pictures);
  };

  return (
    <div
      {...rest}
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      contentEditable={disabled ? 'false' : 'true'}
      suppressContentEditableWarning
      data-placeholder={placeholder ?? ''}
      data-empty={empty ? 'true' : 'false'}
      style={{ minHeight: `${minRows * 1.5 + 1}rem` }}
      onInput={emit}
      onPaste={onPaste}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`w-full whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] aria-disabled:opacity-60 data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-[var(--color-content-subtle)] data-[empty=true]:before:content-[attr(data-placeholder)] ${
        dragOver ? DRAG_OVER_CLASS : ''
      } ${className ?? ''}`}
    />
  );
});
