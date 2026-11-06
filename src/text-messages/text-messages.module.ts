import { Global, Module } from '@nestjs/common';
import { TextMessageService } from './text-message.service';
import { TextMessageRepliesController } from './text-message-replies.controller';

@Global()
@Module({
  controllers: [TextMessageRepliesController],
  providers: [TextMessageService],
  exports: [TextMessageService],
})
export class TextMessagesModule {}
