import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { MedicationEventReportTypeFilter } from '../../medication-administration/dto/medication-administration-query.dto';

export class MedicationReportQueryDto {
  @ApiProperty()
  @IsDateString()
  dateFrom!: string;

  @ApiProperty()
  @IsDateString()
  dateTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allServiceUsers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationId?: string;

  @ApiPropertyOptional({ enum: MedicationEventReportTypeFilter })
  @IsOptional()
  @IsEnum(MedicationEventReportTypeFilter)
  reportType?: MedicationEventReportTypeFilter;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
