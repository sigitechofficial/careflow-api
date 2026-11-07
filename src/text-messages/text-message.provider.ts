import type { TextMessageInbound } from './text-message-replies.util';

/**
 * A text message (SMS) provider. CareFlow sends survey invitations and reminders through
 * TextMessageService, which picks the provider by TEXT_MESSAGE_MODE. Only "log" (the default: writes
 * a masked number and the message length to the API log and sends nothing) and "off" exist today. A
 * UK provider is added behind this interface once the organisation chooses one; no provider package
 * is installed until then.
 */
export interface TextMessageProvider {
  readonly name: string;
  /** The provider handles replies (e.g. "Reply STOP"). Only then may messages offer replying STOP. */
  readonly supportsReplies: boolean;
  /** `to` is always a normalised UK mobile (+447…); `body` never contains answers. */
  send(input: { to: string; body: string }): Promise<{ messageId: string }>;
  /**
   * Replies (present exactly when supportsReplies): checks a request came from the provider and reads
   * the replies out of it. CareFlow acts only on stop and start words (text-message-replies.util.ts).
   */
  readonly inbound?: TextMessageInbound;
}

/** log (default): nothing sent; off: no texts at all; live: the configured provider sends them. */
export type TextMessageMode = 'log' | 'off' | 'live';

export function resolveTextMessageMode(raw: unknown): TextMessageMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'off' ? 'off' : v === 'live' ? 'live' : 'log';
}
