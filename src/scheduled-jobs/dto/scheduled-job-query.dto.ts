import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ScheduledJobPriority } from '../enums/scheduled-job-priority.enum';
import { ScheduledJobStatus } from '../enums/scheduled-job-status.enum';

export class ScheduledJobQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleRunId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ enum: ScheduledJobStatus })
  @IsOptional()
  @IsEnum(ScheduledJobStatus)
  status?: ScheduledJobStatus;

  @ApiPropertyOptional({ enum: ScheduledJobPriority })
  @IsOptional()
  @IsEnum(ScheduledJobPriority)
  priority?: ScheduledJobPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiPropertyOptional({ description: 'ISO date-time' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date-time' })
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

  @ApiPropertyOptional({
    enum: ['scheduledStartDateTime', 'createdAt', 'updatedAt', 'jobName', 'status', 'priority'],
  })
  @IsOptional()
  @IsString()
  sortBy?:
    | 'scheduledStartDateTime'
    | 'createdAt'
    | 'updatedAt'
    | 'jobName'
    | 'status'
    | 'priority' = 'scheduledStartDateTime';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}
