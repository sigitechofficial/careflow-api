import { Global, Module } from '@nestjs/common';
import { SignInSessionsService } from './sign-in-sessions.service';

/** Signed-in devices (office website and Care app): used by sign-in, renewal, every request, and account changes. */
@Global()
@Module({
  providers: [SignInSessionsService],
  exports: [SignInSessionsService],
})
export class SignInSessionsModule {}
