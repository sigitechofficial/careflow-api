import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyManagerCopiesService } from './survey-manager-copies.service';
import { MAX_MIN_TEAM, MIN_TEAM } from './survey-manager-copies.util';

export class CreateManagerCopiesDto {
  @ApiPropertyOptional({ maxLength: 60, description: 'Added to each title, e.g. "June 2027"' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiPropertyOptional({ description: 'Managers who can open surveys have had that access dealt with' })
  @IsOptional()
  @IsBoolean()
  confirmAccess?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Library roles whose own staff are not asked (e.g. REGISTERED_MANAGER). Omit for the ready-made survey’s choice.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  exclude?: string[];

  @ApiPropertyOptional({
    minimum: MIN_TEAM,
    maximum: MAX_MIN_TEAM,
    description: 'Smallest team that gets its own copy. At least the survey’s reporting threshold for results (checked by the service). Omit for the ready-made survey’s.',
  })
  @IsOptional()
  // Bounds are checked by the service, which says why it cannot go lower.
  @IsInt()
  minTeam?: number;
}

/** "Make a copy for each manager" (SUR-STF-018 and staff surveys using {{manager}}). */
@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/manager-copies')
export class SurveyManagerCopiesController {
  constructor(private readonly copies: SurveyManagerCopiesService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Which copies would be made: one per manager, a pooled one for smaller teams, and who gets none' })
  plan(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    /** Comma-separated library roles whose own staff are not asked ("" = none); omitted = the ready-made default. */
    @Query('exclude') exclude?: string,
    /** The smallest team that gets its own copy (a whole number); omitted = the ready-made survey's. */
    @Query('minTeam') minTeam?: string,
  ) {
    const keys = exclude === undefined ? undefined : exclude.split(',').map((s) => s.trim()).filter(Boolean);
    if (minTeam !== undefined && !/^\d{1,3}$/.test(minTeam.trim())) throw new BadRequestException('The smallest team must be a whole number.');
    return this.copies.plan(user, surveyId, keys, minTeam === undefined ? undefined : Number(minTeam.trim()));
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Make the copies as drafts with the staff chosen (audited)' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: CreateManagerCopiesDto,
    @Req() req: Request,
  ) {
    return this.copies.create(user, surveyId, dto, getRequestAuditMeta(req));
  }
}
