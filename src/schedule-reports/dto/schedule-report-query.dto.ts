import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ScheduledJobStatus } from '../../scheduled-jobs/enums/scheduled-job-status.enum';

export class ScheduleReportQueryDto {
  @ApiProperty({ example: '2026-05-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom!: string;

  @ApiProperty({ example: '2026-05-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleBatchId?: string;

  @ApiPropertyOptional({ enum: ScheduledJobStatus })
  @IsOptional()
  @IsEnum(ScheduledJobStatus)
  status?: ScheduledJobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeCancelled?: boolean = false;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({
    description: 'When true, records export audit log (file generation placeholder).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  export?: boolean = false;
}
