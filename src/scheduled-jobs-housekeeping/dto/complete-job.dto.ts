import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CompleteJobDto {
  @ApiPropertyOptional({ description: 'Completion notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Care pathway form IDs delivered during this visit',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deliveredCarePlanFormIds?: string[];

  @ApiPropertyOptional({ description: 'Actual end time (ISO 8601); defaults to now for visits' })
  @IsOptional()
  @IsISO8601()
  actualEndDateTime?: string;
}
