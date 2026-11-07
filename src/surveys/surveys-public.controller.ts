import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
  @Get(':token/form-tokens')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Kiosk tablet: a stock of form tokens for a shared link (answers taken offline are sent later)',
    description: 'Shared links only (404 otherwise). Each token is used once and lasts 24 hours.',
  })
  @ApiQuery({ name: 'count', required: false, description: 'How many (1 to 25, default 1)' })
  formTokens(@Param('token') token: string, @Query('count') count?: string) {
    return this.service.shareFormTokens(token, Number(count ?? 1));
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
