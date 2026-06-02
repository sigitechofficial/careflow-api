import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationKind, MedicationSchedulePattern } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class MedicationSchedulePreviewItemDto {
  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  dueVisitName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roundId?: string;

  @ApiPropertyOptional({ type: [String], example: ['MONDAY', 'WEDNESDAY', 'FRIDAY'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];
}

export class MedicationSchedulePreviewDto {
  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-05-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 30, description: 'Used when endDate omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  previewDays?: number;

  @ApiPropertyOptional({ enum: MedicationKind, default: MedicationKind.REGULAR })
  @IsOptional()
  @IsEnum(MedicationKind)
  medicationKind?: MedicationKind;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyIntervalDays?: number;

  @ApiPropertyOptional({ enum: MedicationSchedulePattern })
  @IsOptional()
  @IsEnum(MedicationSchedulePattern)
  schedulePattern?: MedicationSchedulePattern;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  monthlyDayOfMonth?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  monthlyAnchorToStartDate?: boolean;

  @ApiProperty({ type: [MedicationSchedulePreviewItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MedicationSchedulePreviewItemDto)
  schedules!: MedicationSchedulePreviewItemDto[];
}
