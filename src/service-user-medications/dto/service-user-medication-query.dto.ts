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
  Min,
} from 'class-validator';
import { MedicationKind, MedicationRecordStatus } from '@prisma/client';

export class ServiceUserMedicationQueryDto {
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
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: MedicationKind })
  @IsOptional()
  @IsEnum(MedicationKind)
  medicationKind?: MedicationKind;

  @ApiPropertyOptional({ enum: MedicationRecordStatus })
  @IsOptional()
  @IsEnum(MedicationRecordStatus)
  status?: MedicationRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showPastEndDate?: boolean;

  @ApiPropertyOptional({ description: 'List soft-deleted (archived) medications only' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  archivedOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isControlledMedication?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
