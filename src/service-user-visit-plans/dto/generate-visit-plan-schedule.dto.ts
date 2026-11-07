import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class GenerateVisitPlanScheduleDto {
  @ApiProperty({ example: '2026-07-08' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2026-07-21' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional({ description: 'Optional schedule area for generated jobs' })
  @IsOptional()
  @IsUUID()
  scheduleAreaId?: string | null;

  @ApiPropertyOptional({
    description:
      'Create visits up to N days before fromDate. Must not exceed the organisation Max backfill days ' +
      '(Settings → Dom Care); a slot with its own Max backfill days (> 0) is capped by that too.',
    minimum: 0,
    maximum: 31,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  backfillDays?: number;

  @ApiPropertyOptional({
    description:
      'When true, only create visits for the N days strictly before fromDate (rota start). ' +
      'Ignores toDate end bound and allows days before each slot Start Date within Max backfill days.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  backfillOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'Only allocate carers on visits that match their working pattern. When omitted, uses the visit plan stored preference (default true).',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  respectWorkingPatternOnSync?: boolean;
}
