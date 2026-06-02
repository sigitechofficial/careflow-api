import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
} from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateInitialAssessmentRiskRecordDto {
  @ApiProperty({ enum: InitialAssessmentRiskType })
  @IsEnum(InitialAssessmentRiskType)
  riskType!: InitialAssessmentRiskType;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: InitialAssessmentRiskLevel })
  @IsEnum(InitialAssessmentRiskLevel)
  likelihood!: InitialAssessmentRiskLevel;

  @ApiProperty({ enum: InitialAssessmentRiskLevel })
  @IsEnum(InitialAssessmentRiskLevel)
  severity!: InitialAssessmentRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  controlMeasures?: string;

  @ApiPropertyOptional({ enum: InitialAssessmentRiskLevel })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskLevel)
  residualRisk?: InitialAssessmentRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsiblePersonId?: string;
}

export class UpdateInitialAssessmentRiskRecordDto {
  @ApiPropertyOptional({ enum: InitialAssessmentRiskType })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskType)
  riskType?: InitialAssessmentRiskType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: InitialAssessmentRiskLevel })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskLevel)
  likelihood?: InitialAssessmentRiskLevel;

  @ApiPropertyOptional({ enum: InitialAssessmentRiskLevel })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskLevel)
  severity?: InitialAssessmentRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  controlMeasures?: string;

  @ApiPropertyOptional({ enum: InitialAssessmentRiskLevel })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskLevel)
  residualRisk?: InitialAssessmentRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string | null;

  @ApiPropertyOptional({ enum: InitialAssessmentRiskStatus })
  @IsOptional()
  @IsEnum(InitialAssessmentRiskStatus)
  status?: InitialAssessmentRiskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsiblePersonId?: string | null;
}
