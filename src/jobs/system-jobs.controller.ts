import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JOB_RUN_STATUSES } from './job-run.types';
import { SYSTEM_JOBS_MANAGE, SYSTEM_JOBS_READ } from './jobs.constants';
import { SystemJobsService } from './system-jobs.service';

export class SystemJobRunsQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ enum: JOB_RUN_STATUSES })
  @IsOptional()
  @IsIn(JOB_RUN_STATUSES)
  status?: string;
}

/** Super Admin "System jobs": scheduled job health, run history and "Run now". */
@ApiTags('System jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('system-jobs')
export class SystemJobsController {
  constructor(private readonly service: SystemJobsService) {}

  @Get()
  @AnyPermission(SYSTEM_JOBS_READ, SYSTEM_JOBS_MANAGE)
  @ApiOperation({
    summary: 'All scheduled jobs with health, last run and next expected run',
  })
  list() {
    return this.service.list();
  }

  @Get(':name/runs')
  @AnyPermission(SYSTEM_JOBS_READ, SYSTEM_JOBS_MANAGE)
  @ApiOperation({ summary: 'Run history for one job (newest first)' })
  runs(@Param('name') name: string, @Query() q: SystemJobRunsQueryDto) {
    return this.service.runs(name, q.limit ?? 50, q.status);
  }

  @Post(':name/run')
  @HttpCode(200)
  @Permissions(SYSTEM_JOBS_MANAGE)
  @ApiOperation({
    summary:
      'Run a job now (source manual; max 1 per job per minute, 429 otherwise). Long runs return status running.',
  })
  runNow(
    @CurrentUser() user: RequestUser,
    @Param('name') name: string,
    @Req() req: Request,
  ) {
    return this.service.runNow(name, user.id, getRequestAuditMeta(req));
  }
}
