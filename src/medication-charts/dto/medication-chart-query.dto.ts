import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

export class MedicationRegularChartQueryDto {
  @ApiProperty({ example: '2026-05', description: 'Calendar month YYYY-MM' })
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be YYYY-MM' })
  month!: string;
}

export class MedicationPrnChartQueryDto {
  @ApiProperty()
  @IsDateString()
  dateFrom!: string;

  @ApiProperty()
  @IsDateString()
  dateTo!: string;
}
