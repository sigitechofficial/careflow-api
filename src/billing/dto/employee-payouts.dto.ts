import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

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
}

export class CreateEmployeePayoutBatchDto {
  @ApiProperty({
    description: 'UK payroll run id (must be STATUTORY_CALCULATED or CLOSED)',
  })
  @IsUUID()
  ukPayrollRunId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
