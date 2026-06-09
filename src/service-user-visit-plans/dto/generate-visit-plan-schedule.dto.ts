import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

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
}
