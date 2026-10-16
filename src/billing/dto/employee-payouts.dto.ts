import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class EmployeePayoutsQueryDto {
  @ApiPropertyOptional({ description: 'Period key YYYY-MM or YYYY-Www' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$|^\d{4}-W\d{2}$/)
  periodKey?: string;

  @ApiPropertyOptional({ description: 'Filter batches by UK payroll run id' })
  @IsOptional()
  @IsUUID()
  ukPayrollRunId?: string;

  @ApiPropertyOptional({
    description:
      'Scope to batches with at least one payout line for an employee employed at this location',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class SettleEmployeePayoutBatchDto {
  @ApiProperty({ description: 'Bank or payment provider reference for this batch' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  paymentReference!: string;

  @ApiProperty({ description: 'Date the money left the account (YYYY-MM-DD), not in the future' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  settledOn!: string;

  @ApiPropertyOptional({ description: 'Where the evidence is held (statement line, provider report…)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  settlementEvidence?: string;
}

export class CancelEmployeePayoutBatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateEmployeePayoutBatchDto {
  @ApiProperty({
    description: 'UK payroll run id (must be CLOSED)',
  })
  @IsUUID()
  ukPayrollRunId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** D-20: why expenses of an earlier UK run are being released for payment now. */
export class ReleaseHistoricReimbursementDto {
  @ApiProperty({ description: 'Who checked that these expenses were not paid another way, and how' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
