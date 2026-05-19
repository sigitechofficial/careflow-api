import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ScheduleBuildSource } from '../enums/schedule-build-source.enum';
import { BuildScheduleJobDto } from './build-schedule-job.dto';

export class BuildScheduleDto {
  @ApiProperty({ example: '2026-05-05' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduleDate must be YYYY-MM-DD' })
  scheduleDate!: string;

  @ApiProperty({ enum: ScheduleBuildSource })
  @IsEnum(ScheduleBuildSource)
  buildSource!: ScheduleBuildSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'When omitted, all active schedule areas are included' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  areaIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({
    type: [BuildScheduleJobDto],
    description: 'When provided, creates ScheduledJob and ScheduledVisit records for this build',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildScheduleJobDto)
  jobs?: BuildScheduleJobDto[];
}
