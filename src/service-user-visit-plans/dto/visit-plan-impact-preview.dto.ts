import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { GenerateVisitPlanScheduleDto } from './generate-visit-plan-schedule.dto';

export class GenerateVisitPlanSchedulePreviewQueryDto extends GenerateVisitPlanScheduleDto {}

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
