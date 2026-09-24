import {
  MedicalAlertCategory,
  MedicalAlertSeverity,
  MedicalConditionCategory,
  ReasonableAdjustmentType,
  ServiceUserClinicalDataSource,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateServiceUserMedicalConditionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  conditionId!: string;

  @ApiPropertyOptional({ enum: ServiceUserMedicalConditionStatus })
  @IsOptional()
  @IsEnum(ServiceUserMedicalConditionStatus)
  status?: ServiceUserMedicalConditionStatus;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}

export class UpdateServiceUserMedicalConditionDto extends PartialType(
  CreateServiceUserMedicalConditionDto,
) {}

export class CreateReasonableAdjustmentDto {
  @ApiProperty({ enum: ReasonableAdjustmentType })
  @IsEnum(ReasonableAdjustmentType)
  type!: ReasonableAdjustmentType;

  @ApiProperty({ maxLength: 20_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  description!: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}

export class UpdateReasonableAdjustmentDto {
  @ApiPropertyOptional({ enum: ReasonableAdjustmentType })
  @IsOptional()
  @IsEnum(ReasonableAdjustmentType)
  type?: ReasonableAdjustmentType;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}

export class CreateMedicalHistoryEventDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Approximate date when exact date unknown' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  approximateDate?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}

export class UpdateMedicalHistoryEventDto extends PartialType(CreateMedicalHistoryEventDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertMonitoringConfigDto {
  @ApiProperty({
    description:
      'Known monitoring keys including WEIGHT_CHANGE_THRESHOLD_KG, FLUID_TARGET_REQUIRED, and MEDICAL_ALERT_* YES/NO answers',
    example: 'WEIGHT_CHANGE_THRESHOLD_KG',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  configKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Required for WEIGHT_CHANGE_THRESHOLD_KG' })
  @ValidateIf((o: UpsertMonitoringConfigDto) => o.configKey === 'WEIGHT_CHANGE_THRESHOLD_KG')
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  numericValue?: number;

  @ApiPropertyOptional({ description: 'Required for FLUID_TARGET_REQUIRED' })
  @ValidateIf((o: UpsertMonitoringConfigDto) => o.configKey === 'FLUID_TARGET_REQUIRED')
  @IsBoolean()
  booleanValue?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  textValue?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  observationTypeId?: string;
}

export class UpsertUsualParameterDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  observationTypeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  usualNumericValue?: number | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  usualTextValue?: string | null;

  @ApiPropertyOptional({ description: 'Structured usual value for composite observation types' })
  @IsOptional()
  @IsObject()
  usualPayload?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  lowerBand?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  upperBand?: number | null;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;
}

export class UpdateUsualParameterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  usualNumericValue?: number | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  usualTextValue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  usualPayload?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  lowerBand?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  upperBand?: number | null;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;
}

// ─── Medical Condition Catalog DTOs ────────────────────────────────────────

export class CreateMedicalConditionCatalogDto {
  @ApiProperty({ example: 'Dementia' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'DEMENTIA' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ enum: MedicalConditionCategory, example: MedicalConditionCategory.NEUROLOGICAL })
  @IsEnum(MedicalConditionCategory)
  category!: MedicalConditionCategory;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateMedicalConditionCatalogDto extends PartialType(CreateMedicalConditionCatalogDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateMedicalAlertDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ enum: MedicalAlertCategory })
  @IsOptional()
  @IsEnum(MedicalAlertCategory)
  category?: MedicalAlertCategory;

  @ApiPropertyOptional({ enum: MedicalAlertSeverity })
  @IsOptional()
  @IsEnum(MedicalAlertSeverity)
  severity?: MedicalAlertSeverity;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  actionForCarer?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}

export class UpdateMedicalAlertDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ enum: MedicalAlertCategory })
  @IsOptional()
  @IsEnum(MedicalAlertCategory)
  category?: MedicalAlertCategory;

  @ApiPropertyOptional({ enum: MedicalAlertSeverity })
  @IsOptional()
  @IsEnum(MedicalAlertSeverity)
  severity?: MedicalAlertSeverity;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  actionForCarer?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ServiceUserClinicalDataSource })
  @IsOptional()
  @IsEnum(ServiceUserClinicalDataSource)
  source?: ServiceUserClinicalDataSource;
}
