import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { resolveTextMessageMode, type TextMessageMode, type TextMessageProvider } from './text-message.provider';
import { maskMobile, normaliseUkMobile } from './uk-mobile.util';
import { classifyTextReply, type TextReplyHandler } from './text-message-replies.util';
import { MessageDeliveryService } from '../message-delivery/message-delivery.service';

/** Injection token for a real provider (none until the organisation chooses one; log mode otherwise). */
export const TEXT_MESSAGE_PROVIDER = Symbol('TEXT_MESSAGE_PROVIDER');

/** Longest message sent: three SMS segments (GSM-7, 153 characters each). */
export const MAX_TEXT_MESSAGE_LENGTH = 459;

/** Log mode: nothing leaves CareFlow; the API log gets a masked number and the length, never the text. */
export class LogTextMessageProvider implements TextMessageProvider {
  readonly name = 'log';
  readonly supportsReplies = false;
  private readonly logger = new Logger('TextMessage');
  async send(input: { to: string; body: string }) {
    this.logger.log(`[TEXT log] to=${maskMobile(input.to)} length=${input.body.length}`);
    return { messageId: `log-${randomUUID()}` };
  }
}

export type TextSendResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'OFF' | 'HELD' | 'INVALID_NUMBER' | 'TOO_LONG' | 'FAILED' };

/**
 * Text messages (survey invitations and reminders). TEXT_MESSAGE_MODE: "log" (default) or "off".
 * A real provider is plugged in by implementing TextMessageProvider; until then nothing is sent.
 * Never throws: a failed text never fails what sent it. Numbers never appear in logs unmasked and the
 * message text is never logged (it can hold a person's own link).
 */
@Injectable()
export class TextMessageService {
  private readonly logger = new Logger(TextMessageService.name);
  private readonly provider: TextMessageProvider;
  readonly mode: TextMessageMode;

  private readonly replyHandlers: TextReplyHandler[] = [];
  /**
   * The exact public address set at the provider for replies (TEXT_MESSAGE_REPLY_URL, https). Signatures
   * are checked against it, never an address worked out from the request (wrong behind a proxy).
   */
  readonly replyUrl: string | null;

  constructor(
    config: ConfigService,
    @Optional() @Inject(TEXT_MESSAGE_PROVIDER) provider?: TextMessageProvider,
    @Optional() private readonly delivery?: MessageDeliveryService,
  ) {
    const mode = resolveTextMessageMode(config.get<string>('TEXT_MESSAGE_MODE'));
    if (mode === 'live' && !provider) {
      this.logger.warn('TEXT_MESSAGE_MODE is live but no text message provider is set up, so texts are written to the log only');
    }
    this.mode = mode === 'live' && !provider ? 'log' : mode;
    this.provider = this.mode === 'live' && provider ? provider : new LogTextMessageProvider();
    const replyUrl = (config.get<string>('TEXT_MESSAGE_REPLY_URL') ?? '').trim();
    this.replyUrl = /^https:\/\/[^\s]+$/i.test(replyUrl) ? replyUrl : null;
  }

  /** Modules that send texts register what a stop or start reply does (surveys: survey opt-outs). */
  onReply(handler: TextReplyHandler): void {
    this.replyHandlers.push(handler);
  }

  /** Replies can be received (a provider that handles them is in use). */
  receivesReplies(): boolean {
    return this.supportsReplies() && Boolean(this.provider.inbound) && Boolean(this.replyUrl);
  }

  /**
   * Replies posted by the provider. Refused unless the provider handles replies and the request's
   * signature checks out. Only stop and start words are acted on; every other reply is dropped
   * without being stored or logged (people sometimes reply with personal details). Returns counts.
   */
  async receiveReplies(incoming: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | undefined;
    body: unknown;
  }): Promise<{ accepted: boolean; stops: number; starts: number; ignored: number; changed: number }> {
    const none = { accepted: false, stops: 0, starts: 0, ignored: 0, changed: 0 };
    const inbound = this.provider.inbound;
    if (!this.receivesReplies() || !inbound || !this.replyUrl) return none;
    const request = { ...incoming, url: this.replyUrl };
    let verified = false;
    try {
      verified = inbound.verify(request);
    } catch {
      verified = false;
    }
    if (!verified) {
      this.logger.warn('Text replies refused: the request was not signed by the text message provider');
      return none;
    }
    const result = { ...none, accepted: true };
    let messages: Array<{ from: string; text: string }> = [];
    try {
      messages = inbound.parse(request.body);
    } catch {
      messages = [];
    }
    for (const m of messages) {
      const kind = classifyTextReply(m.text);
      const from = normaliseUkMobile(m.from);
      if (!kind || !from) {
        result.ignored += 1;
        continue;
      }
      if (kind === 'STOP') result.stops += 1;
      else result.starts += 1;
      for (const handler of this.replyHandlers) {
        try {
          result.changed += await handler({ kind, from });
        } catch (err) {
          this.logger.warn(`A ${kind.toLowerCase()} reply from ${maskMobile(from)} was not applied (${err instanceof Error ? err.name : 'error'})`);
        }
      }
    }
    return result;
  }

  /** Text messages can be used at all (log mode counts: it stands in for a provider locally). */
  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  /** The provider handles replies, so messages may say "Reply STOP". False in log mode. */
  supportsReplies(): boolean {
    return this.isEnabled() && this.provider.supportsReplies;
  }

  /** Which provider is in use, for screens ("log" = written to the log only, not sent). */
  providerName(): string | null {
    return this.isEnabled() ? this.provider.name : null;
  }

  /**
   * `kind` names the type of text (message-kinds.ts) for Administration › Message delivery, which can switch it off
   * or limit texts to listed numbers ("HELD"). Each outcome is written to the delivery log (number masked).
   */
  async send(input: { to: string; body: string; kind?: string }): Promise<TextSendResult> {
    if (!this.isEnabled()) return { sent: false, reason: 'OFF' };
    const to = normaliseUkMobile(input.to);
    if (!to) return { sent: false, reason: 'INVALID_NUMBER' };
    if (input.body.length > MAX_TEXT_MESSAGE_LENGTH) return { sent: false, reason: 'TOO_LONG' };
    const decision = this.delivery ? await this.delivery.decide('TEXT', input.kind, [to]) : null;
    if (decision && !decision.allowed.length) {
      await this.delivery!.record('TEXT', decision.kind, this.delivery!.heldRows(decision));
      return { sent: false, reason: 'HELD' };
    }
    const kind = decision?.kind ?? input.kind ?? 'other';
    try {
      const { messageId } = await this.provider.send({ to, body: input.body });
      await this.delivery?.record('TEXT', kind, [{ recipient: to, outcome: 'SENT', reason: this.provider.name === 'log' ? 'Written to the log only (no text provider)' : null }]);
      return { sent: true, messageId };
    } catch (err) {
      this.logger.warn(`Text to ${maskMobile(to)} failed (${err instanceof Error ? err.name : 'error'})`);
      await this.delivery?.record('TEXT', kind, [{ recipient: to, outcome: 'FAILED', reason: err instanceof Error ? err.name : 'error' }]);
      return { sent: false, reason: 'FAILED' };
    }
  }
}
