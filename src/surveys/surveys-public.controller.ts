import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto';
import { SurveysService } from './surveys.service';

@ApiTags('Surveys (public)')
@Controller('surveys/public')
export class SurveysPublicController {
  constructor(private readonly service: SurveysService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Load a survey form by recipient share token' })
  getByToken(@Param('token') token: string) {
    return this.service.getPublicByToken(token);
  }

  @Public()
  @Post(':token/responses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit survey answers via recipient share token' })
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitSurveyResponseDto,
    @Req() req: Request,
  ) {
    return this.service.submitPublicResponse(token, dto, getRequestAuditMeta(req));
  }
}
