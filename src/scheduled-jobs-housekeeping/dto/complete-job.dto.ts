import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteJobDto {
  @ApiPropertyOptional({ description: 'Completion notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Actual end time (ISO 8601); defaults to now for visits' })
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;
}
