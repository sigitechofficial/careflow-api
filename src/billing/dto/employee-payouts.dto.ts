import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class EmployeePayoutsQueryDto {
  @ApiPropertyOptional({ description: 'Period key YYYY-MM or YYYY-Www' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$|^\d{4}-W\d{2}$/)
  periodKey?: string;
}

export class CreateEmployeePayoutBatchDto {
  @ApiProperty({
    example: '2026-07',
    description: 'Period key: YYYY-MM (monthly) or YYYY-Www (ISO week)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}$|^\d{4}-W\d{2}$/)
  periodKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class PeriodRangeDto {
  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  dateTo!: string;
}
