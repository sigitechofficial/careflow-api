import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ScheduledVisitStatus } from '../enums/scheduled-visit-status.enum';

export class ScheduledVisitQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ enum: ScheduledVisitStatus })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  /** Comma-separated statuses, e.g. COMPLETED,PARTIALLY_COMPLETED */
  @ApiPropertyOptional({
    description: 'Comma-separated visit statuses (takes precedence over status when set)',
    example: 'COMPLETED,PARTIALLY_COMPLETED',
  })
  @IsOptional()
  @IsString()
  statuses?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['scheduledStartDateTime', 'createdAt', 'updatedAt', 'visitName', 'status'] })
  @IsOptional()
  @IsString()
  sortBy?: 'scheduledStartDateTime' | 'createdAt' | 'updatedAt' | 'visitName' | 'status' =
    'scheduledStartDateTime';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}
