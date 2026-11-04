import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
