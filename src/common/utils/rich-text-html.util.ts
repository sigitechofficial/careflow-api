import sanitizeHtml from 'sanitize-html';

/**
 * Rich-text HTML that users save (policy text, care plan text templates) is shown to other staff and
 * carers as HTML, so it is cut down to an allow-list before it is stored and again before it is served.
 *
 * The allow-list is what the CareFlow editors produce (TipTap StarterKit, underline, text alignment,
 * links and tables) and what the ready-made policy library renders: headings, paragraphs, inline
 * emphasis, lists, quotes, links, tables, line breaks and rules. Everything else is removed; the text
 * of a removed tag is kept, except for script, style and similar tags whose content is dropped too.
 * The admin app applies the same allow-list when it renders (src/shared/lib/sanitize-rich-text.ts).
 */
export const RICH_TEXT_ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

/** Link schemes a saved link may use. Anything else (javascript:, data:, relative paths) loses its href. */
const ALLOWED_LINK_PROTOCOL = /^(https?:|mailto:)/i;

const LINK_REL = 'noopener noreferrer';

const TEXT_ALIGN = [/^(left|right|center|justify)$/];

const ALIGNABLE = ['p', 'h1', 'h2', 'h3', 'h4', 'th', 'td'] as const;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    th: ['colspan', 'rowspan', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    ...Object.fromEntries(
      ALIGNABLE.filter((tag) => tag !== 'th' && tag !== 'td').map((tag) => [tag, ['style']]),
    ),
  },
  // Only text alignment survives in a style attribute (the editor's align buttons write it).
  allowedStyles: Object.fromEntries(ALIGNABLE.map((tag) => [tag, { 'text-align': TEXT_ALIGN }])),
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  selfClosing: ['br', 'hr', 'col'],
  transformTags: {
    a: (tagName, attribs) => {
      const next: sanitizeHtml.Attributes = { ...attribs };
      const href = (next.href ?? '').trim();
      if (href && ALLOWED_LINK_PROTOCOL.test(href)) next.href = href;
      else delete next.href;
      if (next.href) next.rel = LINK_REL;
      else delete next.rel;
      // A link may open in a new tab; no other browsing-context target is kept.
      if (next.target !== undefined) {
        if (next.target.trim().toLowerCase() === '_blank') next.target = '_blank';
        else delete next.target;
      }
      return { tagName, attribs: next };
    },
    th: keepSpanNumbers,
    td: keepSpanNumbers,
  },
};

function keepSpanNumbers(tagName: string, attribs: sanitizeHtml.Attributes) {
  const next: sanitizeHtml.Attributes = { ...attribs };
  for (const key of ['colspan', 'rowspan'] as const) {
    if (next[key] !== undefined && !/^[1-9]\d{0,2}$/.test(next[key].trim())) delete next[key];
  }
  return { tagName, attribs: next };
}

/** Allow-listed copy of user rich-text HTML, safe to store and to render as HTML. */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, OPTIONS);
}

/** {@link sanitizeRichTextHtml} for optional columns: null and undefined pass through unchanged. */
export function sanitizeOptionalRichTextHtml(html: string | null): string | null;
export function sanitizeOptionalRichTextHtml(html: string | null | undefined): string | null | undefined;
export function sanitizeOptionalRichTextHtml(html: string | null | undefined): string | null | undefined {
  return typeof html === 'string' ? sanitizeRichTextHtml(html) : html;
}
