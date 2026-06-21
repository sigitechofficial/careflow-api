import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class VisitPlanScheduleImpactPreviewQueryDto {
  @ApiProperty({ description: 'Start of rota impact range (calendar date, YYYY-MM-DD)' })
  @IsDateString()
  fromDate!: string;

  @ApiPropertyOptional({ description: 'End of range; omit for open-ended (capped)' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
