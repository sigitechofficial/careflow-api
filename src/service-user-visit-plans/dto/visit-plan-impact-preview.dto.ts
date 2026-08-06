import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { GenerateVisitPlanScheduleDto } from './generate-visit-plan-schedule.dto';

/** Query DTO — redeclare fields so ValidationPipe whitelist sees them on GET. */
export class GenerateVisitPlanSchedulePreviewQueryDto extends GenerateVisitPlanScheduleDto {
  @ApiProperty({ example: '2026-07-08' })
  @IsDateString()
  declare fromDate: string;

  @ApiProperty({ example: '2026-07-21' })
  @IsDateString()
  declare toDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  declare scheduleAreaId?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 14 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(14)
  declare backfillDays?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  declare backfillOnly?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true',
  )
  @IsBoolean()
  declare respectWorkingPatternOnSync?: boolean;
}

export class VisitPlanReturnImpactPreviewQueryDto {
  @ApiProperty({ example: '2026-07-08' })
  @IsDateString()
  returnDate!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, default: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  daysAhead?: number;
}

export class VisitPlanSkipImpactPreviewQueryDto {
  @ApiProperty({ example: '2026-07-08' })
  @IsDateString()
  date!: string;
}
