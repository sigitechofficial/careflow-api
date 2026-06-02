import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export enum CarePlanRecommendationDecision {
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

export class InitialAssessmentCarePlanDecisionDto {
  @ApiProperty({ enum: CarePlanRecommendationDecision })
  @IsEnum(CarePlanRecommendationDecision)
  decision!: CarePlanRecommendationDecision;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Required when decision is declined' })
  @ValidateIf((o: InitialAssessmentCarePlanDecisionDto) => o.decision === CarePlanRecommendationDecision.DECLINED)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
