import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';



export class MedicationRegularChartQueryDto {

  @ApiPropertyOptional({
    example: '2026-05',
    description:
      'Calendar month YYYY-MM. Use this **or** `dateFrom` + `dateTo` (not both required; custom range capped at 93 days).',
  })

  @IsOptional()

  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be YYYY-MM' })

  month?: string;



  @ApiPropertyOptional({ example: '2026-05-01', description: 'Start date (inclusive), YYYY-MM-DD' })

  @IsOptional()

  @IsDateString()

  dateFrom?: string;



  @ApiPropertyOptional({ example: '2026-05-31', description: 'End date (inclusive), YYYY-MM-DD' })

  @IsOptional()

  @IsDateString()

  dateTo?: string;



  @ApiPropertyOptional({

    description: 'Comma-separated service user medication IDs to include',

  })

  @IsOptional()

  @IsString()

  medicationIds?: string;

}



export class MedicationRegularChartExportQueryDto extends MedicationRegularChartQueryDto {

  @ApiPropertyOptional({ enum: ['html', 'pdf', 'csv', 'xls', 'xlsx'], default: 'html' })

  @IsOptional()

  @IsIn(['html', 'pdf', 'csv', 'xls', 'xlsx'])

  format?: 'html' | 'pdf' | 'csv' | 'xls' | 'xlsx';



  @ApiPropertyOptional({

    example: '2026-03,2026-04,2026-05',

    description: 'Comma-separated months for multi-month export (Excel: one sheet per month)',

  })

  @IsOptional()

  @IsString()

  months?: string;



  @ApiPropertyOptional({

    description: 'When true, skip export audit log (in-app preview only)',

  })

  @IsOptional()

  @IsIn(['true', '1'])

  preview?: string;



  @ApiPropertyOptional({
    enum: ['summary', 'full'],
    default: 'full',
    example: 'full',
    description:
      'Blister pack export layout: `summary` — compartment aggregate rows only; `full` — includes individual medicine rows under each pack (HTML, PDF, CSV, Excel).',
  })

  @IsOptional()

  @IsIn(['summary', 'full'])

  packExportDetail?: 'summary' | 'full';

}



export class MedicationPrnChartQueryDto {

  @ApiProperty()

  @IsDateString()

  dateFrom!: string;



  @ApiProperty()

  @IsDateString()

  dateTo!: string;

}

