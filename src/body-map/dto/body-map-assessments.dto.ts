import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BodyMapLinkedModule } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BodyMapWoundAssessmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  woundType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  exudate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dressing?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextDressingChange?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  measurements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  infectionSigns?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  professionalInvolvement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  assessmentData?: Record<string, unknown>;
}

export class BodyMapPressureAssessmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  riskTool?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  blanching?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  skinIntact?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  repositioningRecorded?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nonBlanching?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  repositioningFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pressureEquipment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  assessmentData?: Record<string, unknown>;
}

export class CreateBodyMapLinkDto {
  @ApiProperty({ enum: BodyMapLinkedModule })
  @IsEnum(BodyMapLinkedModule)
  linkedModule!: BodyMapLinkedModule;

  @ApiProperty()
  @IsUUID()
  linkedRecordId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class CreateBodyMapRecordAssessmentsDto {
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

export class CloseBodyMapRecordExtendedDto {
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
