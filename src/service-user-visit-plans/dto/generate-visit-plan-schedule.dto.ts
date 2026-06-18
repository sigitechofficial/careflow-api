import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

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
    description: 'Create visits up to N days before fromDate (capped per slot allowBackfillDays)',
    minimum: 0,
    maximum: 14,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  backfillDays?: number;
}
