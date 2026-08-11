import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BodyMapRecordType, BodyMapRiskLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BodyMapSafeguardingCheckDto } from '../../body-map/dto/body-map-safeguarding.dto';
import {
  BodyMapPressureAssessmentDto,
  BodyMapWoundAssessmentDto,
} from '../../body-map/dto/body-map-assessments.dto';
import { BodyMapMedicationSiteDto } from '../../body-map/dto/body-map-medication-site.dto';

export class EmployeeAppBodyMapMarkerDto {
  @ApiProperty({ example: 'front' })
  @IsString()
  @MaxLength(64)
  recordView!: string;

  @ApiProperty({ example: 'dual' })
  @IsString()
  @MaxLength(64)
  canvasView!: string;

  @ApiProperty({ example: 38.5, description: '0–100 percent' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @ApiProperty({ example: 22.1, description: '0–100 percent' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @ApiProperty({ example: 'Left shoulder' })
  @IsString()
  @MaxLength(200)
  bodyPart!: string;

  @ApiPropertyOptional({ example: 'Left' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  side?: string;

  @ApiPropertyOptional({ example: 'left-arm-upper-front' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  regionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summaryLabel?: string;
}

export class EmployeeAppBodyMapWizardTypeDto {
  @ApiPropertyOptional({ example: 'New observation' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  purpose?: string;

  @ApiProperty({ enum: BodyMapRecordType })
  @IsEnum(BodyMapRecordType)
  recordType!: BodyMapRecordType;

  @ApiProperty({ example: 'Bruise' })
  @IsString()
  @MaxLength(120)
  subType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  firstNoticedAt?: string;

  @ApiPropertyOptional({ example: 'Visit' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  noticedDuring?: string;
}

export class EmployeeAppBodyMapWizardLocationDto {
  @ApiPropertyOptional({ example: 'Forearm' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bodyPart?: string;

  @ApiPropertyOptional({ example: 'Right' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  side?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specificLocation?: string;
}

export class EmployeeAppBodyMapWizardObservationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  description!: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @ApiPropertyOptional({ example: 'Intact' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  skinIntact?: string;

  @ApiPropertyOptional({ enum: BodyMapRiskLevel })
  @IsOptional()
  @IsEnum(BodyMapRiskLevel)
  riskLevel?: BodyMapRiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapWoundAssessmentDto)
  woundAssessment?: BodyMapWoundAssessmentDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapPressureAssessmentDto)
  pressureAssessment?: BodyMapPressureAssessmentDto;
}

export class EmployeeAppBodyMapWizardCauseDto {
  @ApiPropertyOptional({ example: 'yes' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  causeKnown?: string;

  @ApiPropertyOptional({ example: 'yes' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  consistentWithInjury?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  causeSummary?: string;
}

export class EmployeeAppBodyMapWizardActionDto {
  @ApiPropertyOptional({ example: 'Yes' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  managerInformed?: string;

  @ApiPropertyOptional({ example: 'yes' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  reviewRequired?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextReviewAt?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  actionSummary!: string;
}

/** Admin-parity wizard submit — one POST after all steps (Type → Location → Observation → Cause → Action). */
export class EmployeeAppBodyMapWizardSubmitDto {
  @ApiProperty({ type: EmployeeAppBodyMapMarkerDto })
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapMarkerDto)
  marker!: EmployeeAppBodyMapMarkerDto;

  @ApiProperty({ type: EmployeeAppBodyMapWizardTypeDto })
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapWizardTypeDto)
  type!: EmployeeAppBodyMapWizardTypeDto;

  @ApiPropertyOptional({ type: EmployeeAppBodyMapWizardLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapWizardLocationDto)
  location?: EmployeeAppBodyMapWizardLocationDto;

  @ApiProperty({ type: EmployeeAppBodyMapWizardObservationDto })
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapWizardObservationDto)
  observation!: EmployeeAppBodyMapWizardObservationDto;

  @ApiPropertyOptional({ type: EmployeeAppBodyMapWizardCauseDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapWizardCauseDto)
  cause?: EmployeeAppBodyMapWizardCauseDto;

  @ApiProperty({ type: EmployeeAppBodyMapWizardActionDto })
  @ValidateNested()
  @Type(() => EmployeeAppBodyMapWizardActionDto)
  action!: EmployeeAppBodyMapWizardActionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapSafeguardingCheckDto)
  safeguardingCheck?: BodyMapSafeguardingCheckDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapMedicationSiteDto)
  medicationSite?: BodyMapMedicationSiteDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  observationDetailsExtra?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  safeguardingTriggered?: boolean;

  @ApiProperty()
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;
}
