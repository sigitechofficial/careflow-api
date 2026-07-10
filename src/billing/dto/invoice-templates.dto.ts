import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BillingCardStatus,
  BillingFrequency,
  InvoiceTemplateLayoutPreset,
  InvoiceTemplateScope,
  InvoiceTemplateType,
} from '@prisma/client';
import { BillingCardQueryDto } from './billing-cards.dto';

export class InvoiceTemplateFieldDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({ example: 'SERVICE_USER_FULL_NAME' })
  @IsString()
  @MaxLength(80)
  systemFieldKey!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateInvoiceTemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ enum: InvoiceTemplateType })
  @IsEnum(InvoiceTemplateType)
  templateType!: InvoiceTemplateType;

  @ApiPropertyOptional({ default: '1.0' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  @ApiPropertyOptional({ enum: InvoiceTemplateScope })
  @IsOptional()
  @IsEnum(InvoiceTemplateScope)
  scope?: InvoiceTemplateScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserFundingId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryMethod?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupingRule?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileNamePattern?: string | null;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({ enum: InvoiceTemplateLayoutPreset, default: 'STANDARD' })
  @IsOptional()
  @IsEnum(InvoiceTemplateLayoutPreset)
  layoutPreset?: InvoiceTemplateLayoutPreset;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeRemittance?: boolean;

  @ApiPropertyOptional({ type: [InvoiceTemplateFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceTemplateFieldDto)
  fields?: InvoiceTemplateFieldDto[];
}

export class UpdateInvoiceTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ enum: InvoiceTemplateType })
  @IsOptional()
  @IsEnum(InvoiceTemplateType)
  templateType?: InvoiceTemplateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  @ApiPropertyOptional({ enum: InvoiceTemplateScope })
  @IsOptional()
  @IsEnum(InvoiceTemplateScope)
  scope?: InvoiceTemplateScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserFundingId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryMethod?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupingRule?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileNamePattern?: string | null;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({ enum: InvoiceTemplateLayoutPreset, default: 'STANDARD' })
  @IsOptional()
  @IsEnum(InvoiceTemplateLayoutPreset)
  layoutPreset?: InvoiceTemplateLayoutPreset;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeRemittance?: boolean;

  @ApiPropertyOptional({ type: [InvoiceTemplateFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceTemplateFieldDto)
  fields?: InvoiceTemplateFieldDto[];
}

export class InvoiceTemplatesQueryDto extends BillingCardQueryDto {
  @ApiPropertyOptional({ enum: InvoiceTemplateType })
  @IsOptional()
  @IsEnum(InvoiceTemplateType)
  templateType?: InvoiceTemplateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string;
}

export class ValidateInvoiceTemplateDto {
  @ApiProperty()
  @IsUUID()
  serviceUserId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fundingId?: string;
}
