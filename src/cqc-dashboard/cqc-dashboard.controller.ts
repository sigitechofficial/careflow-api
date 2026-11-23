import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CqcDashboardService } from './cqc-dashboard.service';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === undefined || (typeof value === 'string' && value.trim() === '')
    ? undefined
    : value;

export class CqcDashboardQueryDto {
  @ApiPropertyOptional({
    description: 'This branch (plus whole-organisation records)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class CqcReportsQueryDto extends CqcDashboardQueryDto {
  @ApiPropertyOptional({
    description: 'How many months back, this month included (default 12)',
    default: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(36)
  months?: number;
}

const ANY_CQC = [
  'cqc_evidence.read',
  'cqc_mock_inspection.read',
  'cqc_notifications.read',
] as const;

/** Governance → CQC dashboard and CQC reports. Each part needs its own read permission. */
@ApiTags('CQC dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cqc-dashboard')
export class CqcDashboardController {
  constructor(private readonly dashboard: CqcDashboardService) {}

  @Get()
  @AnyPermission(...ANY_CQC)
  @ApiOperation({
    summary:
      'CQC readiness: evidence coverage, the latest mock ratings, actions, notifications and what needs attention',
  })
  get(@CurrentUser() user: RequestUser, @Query() query: CqcDashboardQueryDto) {
    return this.dashboard.dashboard(user, query);
  }

  @Get('reports')
  @AnyPermission(...ANY_CQC)
  @ApiOperation({
    summary:
      'CQC reports by month: mock inspection ratings, evidence added, actions and notifications',
  })
  reports(
    @CurrentUser() user: RequestUser,
    @Query() query: CqcReportsQueryDto,
  ) {
    return this.dashboard.reports(user, query);
  }
}
