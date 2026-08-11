import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BodyMapBodyView,
  BodyMapRecordStatus,
  BodyMapRecordType,
  BodyMapRiskLevel,
  BodyMapSide,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { BodyMapSafeguardingCheckDto } from './body-map-safeguarding.dto';
import {
  BodyMapPressureAssessmentDto,
  BodyMapWoundAssessmentDto,
} from './body-map-assessments.dto';
import { BodyMapMedicationSiteDto } from './body-map-medication-site.dto';

export class CreateBodyMapRecordDto {
  @ApiProperty()
  @IsString()
  serviceUserId!: string;

  @ApiProperty({ enum: BodyMapRecordType })
  @IsEnum(BodyMapRecordType)
  recordType!: BodyMapRecordType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ enum: BodyMapRiskLevel })
  @IsOptional()
  @IsEnum(BodyMapRiskLevel)
  riskLevel?: BodyMapRiskLevel;

  @ApiPropertyOptional({ enum: BodyMapRecordStatus })
  @IsOptional()
  @IsEnum(BodyMapRecordStatus)
  status?: BodyMapRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  firstNoticedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  noticedByType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  noticedByName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  causeSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  actionSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  observationDetails?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reviewRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextReviewAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  safeguardingTriggered?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  managerReviewRequired?: boolean;

  @ApiProperty({ enum: BodyMapBodyView })
  @IsEnum(BodyMapBodyView)
  bodyView!: BodyMapBodyView;

  @ApiPropertyOptional({ enum: BodyMapSide })
  @IsOptional()
  @IsEnum(BodyMapSide)
  side?: BodyMapSide;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  bodyPart!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  specificLocation?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  xCoordinate!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  yCoordinate!: number;

  @ApiPropertyOptional({ description: 'Required when safeguarding is triggered' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapSafeguardingCheckDto)
  safeguardingCheck?: BodyMapSafeguardingCheckDto;

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

  @ApiPropertyOptional({
    description: 'Required for MEDICATION records when linking to MAR chart line',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapMedicationSiteDto)
  medicationSite?: BodyMapMedicationSiteDto;

  @ApiPropertyOptional({ description: 'Link to the scheduled job when recorded during a visit' })
  @IsOptional()
  @IsString()
  scheduledJobId?: string;

  @ApiPropertyOptional({ description: 'Link to the scheduled visit when recorded during a visit' })
  @IsOptional()
  @IsString()
  scheduledVisitId?: string;
}

export class UpdateBodyMapRecordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ enum: BodyMapRiskLevel })
  @IsOptional()
  @IsEnum(BodyMapRiskLevel)
  riskLevel?: BodyMapRiskLevel;

  @ApiPropertyOptional({ enum: BodyMapRecordStatus })
  @IsOptional()
  @IsEnum(BodyMapRecordStatus)
  status?: BodyMapRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextReviewAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  causeSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  actionSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  observationDetails?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Reason for edit (stored in audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  editReason?: string;
}

export class CloseBodyMapRecordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  closureNote!: string;

  @ApiPropertyOptional({
    description: 'Required when closing safeguarding, high-risk, or manager-review records',
  })
  @IsOptional()
  @IsBoolean()
  managerSignOff?: boolean;
}

export class BodyMapWoundReviewFieldsDto {
  @ApiPropertyOptional({ enum: ['BETTER', 'SAME', 'WORSE'] })
  @IsOptional()
  @IsString()
  progressionComparison?: 'BETTER' | 'SAME' | 'WORSE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  painChange?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dressingChanged?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  treatmentFollowed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  measurements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dressing?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextDressingChange?: string;
}

export class CreateBodyMapReviewDto {
  @ApiProperty({ enum: ['IMPROVING', 'UNCHANGED', 'WORSENING', 'RESOLVED'] })
  @IsString()
  conditionStatus!: 'IMPROVING' | 'UNCHANGED' | 'WORSENING' | 'RESOLVED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  reviewNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  actionTaken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escalationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextReviewAt?: string;

  @ApiPropertyOptional({ description: '§7.2 wound review fields (WOUND records only)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BodyMapWoundReviewFieldsDto)
  woundReview?: BodyMapWoundReviewFieldsDto;
}
