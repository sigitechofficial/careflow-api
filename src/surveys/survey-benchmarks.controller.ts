import { Body, Controller, Get, Headers, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyBenchmarksService } from './survey-benchmarks.service';

export class SetSurveyBenchmarkSharingDto {
  @ApiProperty()
  @IsBoolean()
  sharing!: boolean;

  @ApiPropertyOptional({ description: 'The agreement version accepted (required to start sharing)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  agreementVersion?: string | null;
}

/** Anonymised sector benchmarks (Phase 3): staff who see every branch. Sharing needs settings.company.update too. */
@ApiTags('Survey benchmarks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys-benchmarks')
export class SurveyBenchmarksController {
  constructor(private readonly benchmarks: SurveyBenchmarksService) {}

  @Get()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Whether we share benchmark figures, the agreement, and exactly what is shared' })
  status(@CurrentUser() u: RequestUser) {
    return this.benchmarks.status(u);
  }

  @Put()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Agree to share anonymised figures with the sector benchmark, or stop' })
  set(@CurrentUser() u: RequestUser, @Body() dto: SetSurveyBenchmarkSharingDto, @Req() req: Request) {
    return this.benchmarks.setSharing(u, dto, getRequestAuditMeta(req));
  }

  @Get('compare')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Our ready-made survey figures beside the sector figures (only while sharing)' })
  compare(@CurrentUser() u: RequestUser) {
    return this.benchmarks.compare(u);
  }
}

/** The benchmark service itself (only where SURVEY_BENCHMARK_HUB_KEYS is set): agencies' keys, not logins. */
@ApiTags('Survey benchmark service')
@Controller('survey-benchmark-hub')
export class SurveyBenchmarkHubController {
  constructor(private readonly benchmarks: SurveyBenchmarksService) {}

  @Public()
  @Post('contributions')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'An agency’s figures (replacing its last ones); answers with the sector figures' })
  receive(@Headers('x-careflow-benchmark-key') key: string | undefined, @Body() body: { rows?: unknown }) {
    return this.benchmarks.receive(key, body?.rows);
  }
}
