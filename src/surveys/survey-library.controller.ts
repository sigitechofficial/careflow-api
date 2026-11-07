import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyLibraryService } from './survey-library.service';

export class AdoptLibrarySurveysDto {
  @ApiProperty({ type: [String], description: 'Ready-made survey ids to adopt as survey templates' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  surveyIds!: string[];
}

/** Surveys → Ready-made surveys. Same permissions as the survey pages (read to view, manage to change). */
@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-library')
export class SurveyLibraryController {
  constructor(private readonly service: SurveyLibraryService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Ready-made surveys (researched for CQC home care) and whether each is adopted' })
  list() {
    return this.service.list();
  }

  @Get('for-template/:surveyId')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'The ready-made survey a template was adopted from, and whether a newer revision exists' })
  forTemplate(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.service.forTemplate(user, surveyId);
  }

  @Get(':id')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: "A ready-made survey's questions and guidance, with the organisation's name filled in" })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post('adopt')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: "Adopt ready-made surveys as the organisation's own (company-wide) survey templates" })
  adopt(@CurrentUser() user: RequestUser, @Body() dto: AdoptLibrarySurveysDto, @Req() req: Request) {
    return this.service.adopt(user, dto.surveyIds, getRequestAuditMeta(req));
  }

  @Post('apply-update/:surveyId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: "Replace an adopted template's details and questions with the latest ready-made revision" })
  applyUpdate(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Req() req: Request) {
    return this.service.applyUpdate(user, surveyId, getRequestAuditMeta(req));
  }
}
