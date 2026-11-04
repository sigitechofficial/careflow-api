import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmployeeExtraHoursPeriod } from '@prisma/client';

export class GrantExtraWeeklyHoursDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: EmployeeExtraHoursPeriod })
  @IsEnum(EmployeeExtraHoursPeriod)
  periodType!: EmployeeExtraHoursPeriod;

  /** DAY: the day. WEEK: any day of the week (Monday–Sunday is used). RANGE: the first day. */
  @ApiProperty({ example: '2026-11-12' })
  @IsISO8601({ strict: true })
  startDate!: string;

  /** RANGE only: the last day. */
  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsISO8601({ strict: true })
  endDate?: string;

  /** WEEK only: several weeks at once (any day of each week; Monday–Sunday is used). Replaces `startDate`'s week. */
  @ApiPropertyOptional({ type: [String], example: ['2026-11-09', '2026-11-23'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsISO8601({ strict: true }, { each: true })
  weekStarts?: string[];

  @ApiProperty({ minimum: 0.25, maximum: 168 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(168)
  extraHours!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CancelExtraWeeklyHoursDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
