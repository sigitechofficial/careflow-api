/**
 * Replies to CareFlow's text messages. Only stop and start words are acted on (the UK mobile
 * industry's usual set); any other reply is ignored and never stored or logged, because people
 * sometimes reply with personal or care details.
 */
export type TextReplyKind = 'STOP' | 'START';

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REMOVE']);
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE', 'OPTIN']);

/**
 * "Stop", " STOP.", "Opt out", "STOP sending these" → STOP; "Start" → START. The reply must be just
 * the word (or "opt out" / "opt in"), except STOP itself, which may be followed by anything: so
 * "Cancel my visit tomorrow" is never taken as a stop. Anything else → null.
 */
export function classifyTextReply(text: string | null | undefined): TextReplyKind | null {
  if (!text) return null;
  const words = text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  if (words[0] === 'STOP') return 'STOP';
  const whole = words.join('');
  if (words.length > 2) return null;
  if (STOP_WORDS.has(whole)) return 'STOP';
  if (START_WORDS.has(whole)) return 'START';
  return null;
}

/** One reply as the provider gave it: who sent it (any format) and the words. */
export type InboundTextMessage = { from: string; text: string };

/**
 * What a provider must offer before CareFlow accepts replies from it: check the request really came
 * from the provider (its signature), and read the replies out of the request.
 */
export interface TextMessageInbound {
  verify(request: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer | undefined; url: string }): boolean;
  parse(body: unknown): InboundTextMessage[];
}

/**
 * Something that acts on stop and start replies (registered by the module that sends the texts;
 * surveys today). `from` is a normalised UK mobile (+447…). Returns how many people it changed.
 */
export type TextReplyHandler = (reply: { kind: TextReplyKind; from: string }) => Promise<number>;
