import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OptionalAboutMeFieldDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional()
  @IsBoolean()
  enabled!: boolean;
}

export class OptionalFamilyShareVisitInfoDto {
  @ApiPropertyOptional()
  @IsBoolean()
  recordedNotes!: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  checklists!: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  photographs!: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  medications!: boolean;
}

export class OrganisationOptionalSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalEmarIntegration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalMedicationListRequired?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionalMedicationAmendRoles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalMhaDetentionRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalRestraintRecordingRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalCarePlanReadRequired?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  optionalCarePlanReadCycleMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFormBuilderRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalRemoveCreateNewCarePlan?: boolean;

  @ApiPropertyOptional({ type: [OptionalAboutMeFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionalAboutMeFieldDto)
  optionalAboutMeFields?: OptionalAboutMeFieldDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalServiceManagementRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalLearningDevSessionsRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyPortalEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilySharingAuthRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyShareAllActions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyShareCarePlans?: boolean;

  @ApiPropertyOptional({ type: OptionalFamilyShareVisitInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptionalFamilyShareVisitInfoDto)
  optionalFamilyShareVisitInfo?: OptionalFamilyShareVisitInfoDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalAllowInspectorLogin?: boolean;
}
