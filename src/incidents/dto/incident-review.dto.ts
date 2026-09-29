import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentExternalInvestigationType,
  IncidentInvestigationScope,
  IncidentPreventability,
  IncidentSeverity,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { INCIDENT_CONTRIBUTING_FACTORS } from '../incident-review.constants';

export class UpsertIncidentReviewDto {
  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  confirmedSeverity?: IncidentSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  investigationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  safeguardingConcern?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  possibleAbuseOrNeglect?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  furtherMedicalAttention?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  externalNotificationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escalationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  managementNotes?: string;
}

export class UpsertIncidentInvestigationDto {
  @ApiPropertyOptional({ enum: IncidentInvestigationScope })
  @IsOptional()
  @IsEnum(IncidentInvestigationScope)
  investigationScope?: IncidentInvestigationScope;

  @ApiPropertyOptional({
    enum: IncidentExternalInvestigationType,
    description: 'Required when investigationScope is EXTERNAL; cleared when INTERNAL',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(IncidentExternalInvestigationType)
  externalType?: IncidentExternalInvestigationType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  whatHappened?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  whyHappened?: string;

  @ApiPropertyOptional({ enum: INCIDENT_CONTRIBUTING_FACTORS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(INCIDENT_CONTRIBUTING_FACTORS, { each: true })
  contributingFactors?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  rootCause?: string;

  @ApiPropertyOptional({ enum: IncidentPreventability })
  @IsOptional()
  @IsEnum(IncidentPreventability)
  preventable?: IncidentPreventability;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;

  @ApiPropertyOptional({ description: 'Mark the investigation as complete' })
  @IsOptional()
  @IsBoolean()
  markComplete?: boolean;
}
