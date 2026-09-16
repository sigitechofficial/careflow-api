import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBillingRunDto {
  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' })
  @IsDateString()
  periodEnd!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class BillingRunsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description:
      'Scope runs that include lines for service users (invoice) or visit reconciliations (payroll) at this location',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class EmployeeEarningsQueryDto {
  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD) — filter by visit planned start' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD) — filter by visit planned start' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Scope salary rows to employees at this branch' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class CreateEmployeeSalaryDeductionDto {
  @ApiProperty({ enum: ['FINE', 'PENALTY'] })
  @IsString()
  @Matches(/^(FINE|PENALTY)$/)
  type!: 'FINE' | 'PENALTY';

  @ApiProperty({ example: 25.0, description: 'Positive GBP amount to deduct' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  amount!: number;

  @ApiProperty({ example: 'Late arrival without notice' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({
    example: '2026-07',
    description: 'Salary period: YYYY-MM (monthly) or YYYY-Www (ISO week, weekly)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}$|^\d{4}-W\d{2}$/)
  salaryMonth!: string;
}
