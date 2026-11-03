import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum CarePlanRecommendationDecision {
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  /** Reviewed, decision postponed. Creates nothing and can be accepted or declined later. */
  DEFERRED = 'deferred',
}

export class InitialAssessmentCarePlanDecisionDto {
  @ApiProperty({ enum: CarePlanRecommendationDecision })
  @IsEnum(CarePlanRecommendationDecision)
  decision!: CarePlanRecommendationDecision;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Required when declining, deferring, or changing an accepted or declined decision',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
