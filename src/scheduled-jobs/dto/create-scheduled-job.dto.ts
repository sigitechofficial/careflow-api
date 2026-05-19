import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ScheduledJobPriority } from '../enums/scheduled-job-priority.enum';
import { ScheduledJobStatus } from '../enums/scheduled-job-status.enum';

export class CreateScheduledJobDto {
  @ApiProperty()
  @IsUUID()
  scheduleBatchId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleRunId?: string;

  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  jobName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty()
  @IsString()
  scheduledStartDateTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requiredCarers?: number;

  @ApiPropertyOptional({ enum: ScheduledJobPriority })
  @IsOptional()
  @IsEnum(ScheduledJobPriority)
  priority?: ScheduledJobPriority;

  @ApiPropertyOptional({ enum: ScheduledJobStatus })
  @IsOptional()
  @IsEnum(ScheduledJobStatus)
  status?: ScheduledJobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  timePeriodColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
