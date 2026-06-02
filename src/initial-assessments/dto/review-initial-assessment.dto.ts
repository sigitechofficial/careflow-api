import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InitialAssessmentStatus } from '../enums/initial-assessment-status.enum';

export class ReviewInitialAssessmentDto {
  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reviewNotes?: string;

  @ApiPropertyOptional({ description: 'Manager approves care package activation' })
  @IsOptional()
  @IsBoolean()
  approvedForCareStart?: boolean;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Conditions attached to care start approval' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  careStartConditions?: string;

  @ApiProperty({ enum: [InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.ARCHIVED] })
  @IsEnum([InitialAssessmentStatus.REVIEWED, InitialAssessmentStatus.ARCHIVED])
  status!: InitialAssessmentStatus.REVIEWED | InitialAssessmentStatus.ARCHIVED;
}
