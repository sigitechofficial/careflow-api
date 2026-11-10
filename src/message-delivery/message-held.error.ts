import { ConflictException } from '@nestjs/common';
import { HOLD_REASON_TEXT, type HoldReason } from './message-delivery.rules';

/**
 * A message that Administration › Message delivery held back for every recipient. Shown to staff as a 409 with the
 * reason, so a quote or invoice "sent" during testing or maintenance isn't mistaken for one that went.
 */
export class MessageHeldError extends ConflictException {
  constructor(readonly reason: HoldReason) {
    super(`Not sent: ${HOLD_REASON_TEXT[reason].toLowerCase()}. This can be changed in Administration › Message delivery.`);
  }
}

export const isMessageHeld = (err: unknown): err is MessageHeldError => err instanceof MessageHeldError;
