import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  EcmArrivalClassification,
  EcmLifecycleStatus,
  EcmMissedClassification,
} from '@prisma/client';

export class EcmLiveDashboardQueryDto {
  @ApiPropertyOptional({
    description:
      'ISO date YYYY-MM-DD (single operational day). Ignored when dateFrom/dateTo are set.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive operational-day range start (YYYY-MM-DD, organisation timezone calendar)',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive operational-day range end (YYYY-MM-DD). Defaults to dateFrom when omitted.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Branch / schedule area id' })
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string;

  @ApiPropertyOptional({
    description:
      'Organisation location id — matches schedule-area location or service-user home location',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ enum: EcmArrivalClassification })
  @IsOptional()
  @IsEnum(EcmArrivalClassification)
  arrivalClassification?: EcmArrivalClassification;

  @ApiPropertyOptional({ enum: EcmMissedClassification })
  @IsOptional()
  @IsEnum(EcmMissedClassification)
  missedClassification?: EcmMissedClassification;

  @ApiPropertyOptional({ enum: EcmLifecycleStatus })
  @IsOptional()
  @IsEnum(EcmLifecycleStatus)
  lifecycleStatus?: EcmLifecycleStatus;

  @ApiPropertyOptional({
    description: 'Max visit rows per page (default 150).',
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from previous page (`plannedStartIso|scheduledJobId`).',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Free-text search on job name / SU name' })
  @IsOptional()
  @IsString()
  search?: string;
}
