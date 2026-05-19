import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { ScheduledJobStatus } from '../../scheduled-jobs/enums/scheduled-job-status.enum';

export class FilterJobsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  timePeriodColors?: string[];

  @ApiPropertyOptional({ enum: ['time', 'serviceUser'] })
  @IsOptional()
  @IsEnum(['time', 'serviceUser'])
  sortBy?: 'time' | 'serviceUser';

  @ApiPropertyOptional({ example: '2026-05-05' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional({ enum: ScheduledJobStatus })
  @IsOptional()
  @IsEnum(ScheduledJobStatus)
  status?: ScheduledJobStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
