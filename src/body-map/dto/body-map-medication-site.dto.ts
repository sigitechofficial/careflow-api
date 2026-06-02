import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BodyMapEmollientFireRisk } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BodyMapBodyView, BodyMapRiskLevel, BodyMapSide } from '@prisma/client';

export class BodyMapMedicationSiteDto {
  @ApiProperty()
  @IsUUID()
  serviceUserMedicationId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  lastAdministrationEventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  medicineNameSnapshot?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  strength?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  frequencyText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  appliedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appliedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  amountOrThickness?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reasonForApplication?: string;

  @ApiPropertyOptional({ enum: BodyMapEmollientFireRisk })
  @IsOptional()
  @IsEnum(BodyMapEmollientFireRisk)
  fireRiskEmollient?: BodyMapEmollientFireRisk;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  outcomeNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  oldPatchPresent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  oldPatchRemoved?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  oldPatchRemovalAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  oldPatchBodyPart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  oldPatchNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  disposalRecorded?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  nextChangeDue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  siteRotationChecked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  secondStaffCheck?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  siteRotationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  assessmentData?: Record<string, unknown>;
}

export class UpsertBodyMapMedicationSiteDto extends BodyMapMedicationSiteDto {}

export class PatchBodyMapMedicationSiteAdministrationDto {
  @ApiProperty({
    nullable: true,
    description: 'MAR administration event UUID, or null to clear the dose-at-site link',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  lastAdministrationEventId!: string | null;
}

/** Create medication site record from MAR — includes marker placement (same as body map create). */
export class CreateMedicationBodyMapSiteFromMarDto {
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

  @ApiProperty({ type: BodyMapMedicationSiteDto })
  @ValidateNested()
  @Type(() => BodyMapMedicationSiteDto)
  medicationSite!: BodyMapMedicationSiteDto;
}
