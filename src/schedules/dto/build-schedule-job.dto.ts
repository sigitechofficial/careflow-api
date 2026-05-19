import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScheduledJobPriority } from '../../scheduled-jobs/enums/scheduled-job-priority.enum';
import { ScheduledJobStatus } from '../../scheduled-jobs/enums/scheduled-job-status.enum';
import { ScheduledVisitStatus } from '../../scheduled-visits/enums/scheduled-visit-status.enum';

export class BuildScheduleVisitActionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionType?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class BuildScheduleVisitDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  visitName!: string;

  @ApiProperty({ description: 'ISO 8601 date-time' })
  @IsString()
  scheduledStartDateTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional({ enum: ScheduledVisitStatus, default: ScheduledVisitStatus.PLANNED })
  @IsOptional()
  @IsEnum(ScheduledVisitStatus)
  status?: ScheduledVisitStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requiredCarers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ type: [BuildScheduleVisitActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildScheduleVisitActionDto)
  actions?: BuildScheduleVisitActionDto[];
}

export class BuildScheduleJobDto {
  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleRunId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  jobName!: string;

  @ApiProperty({ description: 'ISO 8601 date-time' })
  @IsString()
  scheduledStartDateTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledEndDateTime?: string;

  @ApiPropertyOptional({ enum: ScheduledJobPriority, default: ScheduledJobPriority.NORMAL })
  @IsOptional()
  @IsEnum(ScheduledJobPriority)
  priority?: ScheduledJobPriority;

  @ApiPropertyOptional({ enum: ScheduledJobStatus, default: ScheduledJobStatus.UNALLOCATED })
  @IsOptional()
  @IsEnum(ScheduledJobStatus)
  status?: ScheduledJobStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requiredCarers?: number;

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

  @ApiPropertyOptional({ type: [BuildScheduleVisitDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildScheduleVisitDto)
  visits?: BuildScheduleVisitDto[];

  @ApiPropertyOptional({ type: [BuildScheduleVisitActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildScheduleVisitActionDto)
  actions?: BuildScheduleVisitActionDto[];
}
