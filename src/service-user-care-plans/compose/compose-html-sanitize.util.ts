import type {
  CarePlanFieldProvenance,
  CarePlanFieldSuggestion,
  CarePlanSuggestionSourceQuestion,
  ComposePlanResult,
} from './compose-context.types';

const BLOCK_BREAK_TAG = /<\/\s*(p|div|li|h[1-6]|tr|blockquote|ul|ol|table|section|article)\s*>/gi;
const BLOCK_OPEN_TAG = /<\s*(p|div|li|h[1-6]|tr|blockquote|ul|ol|table|section|article)(\s[^>]*)?>/gi;
const BR_TAG = /<\s*br\s*\/?>/gi;
const HTML_TAG = /<[^>]+>/g;
const HAS_HTML_MARKUP = /<[^>]+>|<\/\s*\w+/i;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizePlainTextLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripRichTextToPlainText(raw: string): string {
  let text = raw.trim();
  if (!text) return '';

  // Decode entity-encoded markup (&lt;p&gt;...) before tag stripping.
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeHtmlEntities(text);
  }

  text = text
    .replace(BR_TAG, '\n')
    .replace(BLOCK_BREAK_TAG, '\n')
    .replace(BLOCK_OPEN_TAG, '')
    .replace(HTML_TAG, '');

  return normalizePlainTextLines(text);
}

/**
 * Strip IA rich-text HTML before writing compose values or suggestion text.
 * Plain strings pass through unchanged (aside from entity decoding when present).
 */
export function sanitizeComposeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';

  const raw = value.trim();
  if (!raw) return '';

  if (!/[<&]/.test(raw)) return raw;

  return stripRichTextToPlainText(raw);
}

/** Sanitize and return null when the result is empty (e.g. `<p><br></p>`). */
export function sanitizeComposeTextOrNull(value: unknown): string | null {
  const sanitized = sanitizeComposeText(value);
  return sanitized.length > 0 ? sanitized : null;
}

function sanitizeOptionalComposeText(value: string | undefined): string | undefined {
  if (value == null) return value;
  return sanitizeComposeText(value);
}

function sanitizeComposeStringValue(value: string | boolean | null | undefined): string | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  return sanitizeComposeText(value);
}

function sanitizeComposeSourceQuestions(
  sources: CarePlanSuggestionSourceQuestion[] | undefined,
): CarePlanSuggestionSourceQuestion[] | undefined {
  if (!sources) return sources;
  return sources.map((source) => ({
    ...source,
    sourceValue: sanitizeComposeText(source.sourceValue),
  }));
}

function sanitizeComposeSuggestion(suggestion: CarePlanFieldSuggestion): CarePlanFieldSuggestion {
  const suggestedValue =
    typeof suggestion.suggestedValue === 'string'
      ? sanitizeComposeText(suggestion.suggestedValue)
      : suggestion.suggestedValue;

  return {
    ...suggestion,
    suggestedValue,
    displayText: sanitizeComposeText(suggestion.displayText),
    sourceValue: sanitizeOptionalComposeText(suggestion.sourceValue),
    sourceQuestions: sanitizeComposeSourceQuestions(suggestion.sourceQuestions) ?? [],
  };
}

function sanitizeComposeProvenanceEntry(entry: CarePlanFieldProvenance): CarePlanFieldProvenance {
  return {
    ...entry,
    originalValue: sanitizeComposeStringValue(entry.originalValue),
    sourceQuestions: sanitizeComposeSourceQuestions(entry.sourceQuestions),
  };
}

/** Final safety pass for Home Support Plan compose output — values, suggestions, provenance. */
export function sanitizeHomeSupportPlanComposeOutput(result: ComposePlanResult): ComposePlanResult {
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(result.values)) {
    values[key] = typeof value === 'string' ? sanitizeComposeText(value) : value;
  }

  const suggestions = result.suggestions?.map(sanitizeComposeSuggestion);
  const provenance = result.provenance
    ? Object.fromEntries(
        Object.entries(result.provenance).map(([key, entry]) => [
          key,
          sanitizeComposeProvenanceEntry(entry),
        ]),
      )
    : result.provenance;

  const composedFromProvenance = result.composedFrom?.fieldProvenance;
  const fieldProvenance =
    composedFromProvenance && typeof composedFromProvenance === 'object' && !Array.isArray(composedFromProvenance)
      ? Object.fromEntries(
          Object.entries(composedFromProvenance as Record<string, CarePlanFieldProvenance>).map(
            ([key, entry]) => [key, sanitizeComposeProvenanceEntry(entry)],
          ),
        )
      : composedFromProvenance;

  return {
    ...result,
    values,
    suggestions,
    provenance,
    composedFrom: fieldProvenance
      ? {
          ...result.composedFrom,
          fieldProvenance,
        }
      : result.composedFrom,
  };
}

/** Returns true when text still contains HTML markup after sanitization (for tests). */
export function composeTextContainsRawHtml(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return HAS_HTML_MARKUP.test(value);
}
