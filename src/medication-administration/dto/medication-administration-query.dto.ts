import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MedicationAdministrationStatus } from '@prisma/client';

export enum MedicationEventReportTypeFilter {
  GIVEN = 'GIVEN',
  NOT_GIVEN = 'NOT_GIVEN',
  MISSED = 'MISSED',
}

export class MedicationAdministrationQueryDto {
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
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated medication UUIDs (duplicate rows)' })
  @IsOptional()
  @IsString()
  medicationIds?: string;

  @ApiPropertyOptional({ enum: MedicationAdministrationStatus })
  @IsOptional()
  @IsEnum(MedicationAdministrationStatus)
  status?: MedicationAdministrationStatus;

  @ApiPropertyOptional({
    description: 'MAR short code (G, R, N, U, …). Preferred over status for history filters.',
    example: 'G',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  statusCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  administeredById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPrn?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roundId?: string;

  @ApiPropertyOptional({ enum: MedicationEventReportTypeFilter })
  @IsOptional()
  @IsEnum(MedicationEventReportTypeFilter)
  reportType?: MedicationEventReportTypeFilter;

  @ApiPropertyOptional({ description: 'Exception statuses needing manager review' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  needsReview?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
