import { Controller, ForbiddenException, HttpCode, NotFoundException, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { TextMessageService } from './text-message.service';

/**
 * Where the text message provider posts replies (set as the provider's reply address once one is
 * chosen, and the same address in TEXT_MESSAGE_REPLY_URL). Does not exist until a provider that handles replies is in use; refuses anything the
 * provider did not sign. Only stop and start words are acted on.
 */
@ApiExcludeController()
@Controller('text-messages')
export class TextMessageRepliesController {
  constructor(private readonly texts: TextMessageService) {}

  @Public()
  @Post('replies')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async replies(@Req() req: RawBodyRequest<Request>) {
    if (!this.texts.receivesReplies()) throw new NotFoundException();
    const result = await this.texts.receiveReplies({
      headers: req.headers,
      rawBody: req.rawBody,
      // Signatures are checked against TEXT_MESSAGE_REPLY_URL, never the request's own address.
      body: req.body as unknown,
    });
    if (!result.accepted) throw new ForbiddenException();
    return { received: true };
  }
}
