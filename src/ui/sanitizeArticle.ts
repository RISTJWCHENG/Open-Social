/**
 * Cleans a news story's HTML down to text markup before it is shown: only
 * the tags below survive (others are unwrapped to their text, and embedded
 * content is dropped), links keep only an https address and open in a new
 * tab, and no other attribute is kept. Parsing with DOMParser runs no script.
 */
const KEEP = new Set([
  'P',
  'H2',
  'H3',
  'H4',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'STRONG',
  'B',
  'EM',
  'I',
  'A',
  'BR',
  'HR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
]);
/** Dropped with everything inside them. */
const DROP = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'IMG',
  'PICTURE',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'SVG',
  'MATH',
  'CANVAS',
  'FORM',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'TEMPLATE',
  'NOSCRIPT',
  'LINK',
  'META',
]);

function clean(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? '')];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return [];
  const children = [...el.childNodes].flatMap((c) => clean(c, doc));
  if (!KEEP.has(tag)) return children;
  const out = doc.createElement(tag.toLowerCase());
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (/^https:\/\//i.test(href)) {
      out.setAttribute('href', href);
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
    }
  }
  out.append(...children);
  return [out];
}

export function sanitizeArticle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = doc.createElement('div');
  out.append(...[...doc.body.childNodes].flatMap((n) => clean(n, doc)));
  return out.innerHTML;
}

/** About how long the story takes to read, in minutes. */
export function readingMinutes(html: string): number {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 220));
}
