import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InitialAssessmentStatus } from '../enums/initial-assessment-status.enum';

export class ReviewInitialAssessmentDto {
  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reviewNotes?: string;

  @ApiProperty({ enum: [InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.ARCHIVED] })
  @IsEnum([InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.ARCHIVED])
  status!: InitialAssessmentStatus.REVIEWED | InitialAssessmentStatus.ARCHIVED;
}
