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

  @ApiPropertyOptional({ enum: MedicationAdministrationStatus })
  @IsOptional()
  @IsEnum(MedicationAdministrationStatus)
  status?: MedicationAdministrationStatus;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
