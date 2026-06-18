import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional } from 'class-validator';

export class ScheduleImpactPreviewQueryDto {
  @ApiProperty({ description: 'Start of impact range (calendar date)' })
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  startDate!: Date;

  @ApiPropertyOptional({ description: 'End of impact range; omit for open-ended (capped)' })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  endDate?: Date;
}
