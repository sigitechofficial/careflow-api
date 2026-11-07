import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';

/** "Unsubscribe from all surveys": the link in invitations to former people. No login. */
@ApiTags('Survey unsubscribe')
@Controller('survey-unsubscribe')
export class SurveyUnsubscribeController {
  constructor(private readonly unsubscribe: SurveyUnsubscribeService) {}

  @Public()
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Whether an unsubscribe link is real (nothing changes until it is confirmed)' })
  async check(@Param('token') token: string) {
    return { message: 'Unsubscribe', data: await this.unsubscribe.check(token) };
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Stop every survey message to this person, for good' })
  async confirm(@Param('token') token: string) {
    return { message: 'You will not be sent any more surveys.', data: await this.unsubscribe.unsubscribe(token) };
  }
}
