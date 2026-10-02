import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfficeSalaryPeriod } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ListOfficeSalariesQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Month (YYYY-MM); defaults to this month' })
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class UpsertOfficeSalaryDto {
  @ApiProperty({ example: 2500, description: 'Gross salary amount (GBP)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({ enum: OfficeSalaryPeriod, description: 'Whether the amount is per month or per year' })
  @IsEnum(OfficeSalaryPeriod)
  period!: OfficeSalaryPeriod;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 31, description: 'Day of the month salary is paid' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  payDay?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-01' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @MaxLength(100)
  bankAccountName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '12-34-56' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^\d{2}-?\d{2}-?\d{2}$/, { message: 'Sort code must be 6 digits (e.g. 12-34-56)' })
  bankSortCode?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '12345678' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^\d{8}$/, { message: 'Account number must be 8 digits' })
  bankAccountNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Inactive salaries are kept for history but not expected each month' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RecordOfficeSalaryPaymentDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH_PATTERN, { message: 'month must be YYYY-MM' })
  month!: string;

  @ApiPropertyOptional({ description: 'Defaults to the monthly salary' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  amount?: number;

  @ApiPropertyOptional({ example: '2026-10-28' })
  @IsOptional()
  @IsISO8601({ strict: true })
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Bank transfer reference' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
