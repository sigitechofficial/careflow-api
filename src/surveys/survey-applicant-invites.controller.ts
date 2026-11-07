import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyApplicantInvitesService } from './survey-applicant-invites.service';

export class SetApplicantInvitesDto {
  @ApiProperty()
  @IsBoolean()
  on!: boolean;
}

/** Job applicants invited by email with one-time links (Phase 3): surveys.manage. */
@ApiTags('Survey applicant invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/applicant-invites')
export class SurveyApplicantInvitesController {
  constructor(private readonly invites: SurveyApplicantInvitesService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Whether this survey invites job applicants, with counts (never who)' })
  status(@CurrentUser() u: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.invites.status(u, surveyId);
  }

  @Put()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Turn applicant invitations on (one survey at a time) or off' })
  set(@CurrentUser() u: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SetApplicantInvitesDto, @Req() req: Request) {
    return this.invites.setOn(u, surveyId, dto.on, getRequestAuditMeta(req));
  }
}
