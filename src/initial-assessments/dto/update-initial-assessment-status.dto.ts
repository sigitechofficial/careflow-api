import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InitialAssessmentStatus } from '../enums/initial-assessment-status.enum';

export class UpdateInitialAssessmentStatusDto {
  @ApiProperty({ enum: InitialAssessmentStatus })
  @IsEnum(InitialAssessmentStatus)
  status!: InitialAssessmentStatus;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
