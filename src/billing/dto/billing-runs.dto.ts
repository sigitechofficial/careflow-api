import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
