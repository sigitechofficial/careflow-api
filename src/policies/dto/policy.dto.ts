import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  PolicyAudienceTargetType,
  PolicyDocumentSource,
  PolicyDocumentType,
  PolicyLinkModuleType,
  PolicyLinkScope,
  PolicyStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

function emptyToUndefined({ value }: { value: unknown }) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export class PolicyListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: PolicyStatus })
  @IsOptional()
  @IsEnum(PolicyStatus)
  status?: PolicyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PolicyDocumentType })
  @IsOptional()
  @IsEnum(PolicyDocumentType)
  documentType?: PolicyDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Filter versions with reviewDate on or after this date (YYYY-MM-DD)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  reviewDateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter versions with reviewDate on or before this date (YYYY-MM-DD)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  reviewDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'DOMICILIARY' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceTypeCode?: string;
}

export class CreatePolicyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiProperty({ example: 'POL-SAF-001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reference!: string;

  @ApiProperty({ enum: PolicyDocumentType })
  @IsEnum(PolicyDocumentType)
  documentType!: PolicyDocumentType;

  @ApiProperty()
  @IsUUID()
  primaryCategoryId!: string;

  @ApiPropertyOptional({ enum: PolicyDocumentSource, default: PolicyDocumentSource.EDITOR })
  @IsOptional()
  @IsEnum(PolicyDocumentSource)
  source?: PolicyDocumentSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  reviewerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  approverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  parentDocumentId?: string;

  @ApiPropertyOptional({ description: 'Structured editor content' })
  @IsOptional()
  @IsObject()
  contentJson?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Searchable HTML or plain-text representation' })
  @IsOptional()
  @IsString()
  contentHtml?: string;

  @ApiPropertyOptional({ example: '2026-09-03' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ example: '2027-09-03' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ type: () => [PolicyApplicabilityInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyApplicabilityInputDto)
  applicability?: PolicyApplicabilityInputDto[];

  @ApiPropertyOptional({ type: () => [PolicyAudienceInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyAudienceInputDto)
  audiences?: PolicyAudienceInputDto[];

  @ApiPropertyOptional({ type: () => [PolicyLinkInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyLinkInputDto)
  links?: PolicyLinkInputDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];
}

export class PolicyApplicabilityInputDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  organisationWide!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'DOMICILIARY' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceTypeCode?: string;
}

export class PolicyAudienceInputDto {
  @ApiProperty({ enum: PolicyAudienceTargetType })
  @IsEnum(PolicyAudienceTargetType)
  targetType!: PolicyAudienceTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  workAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;
}

export class PolicyLinkInputDto {
  @ApiProperty({ enum: PolicyLinkModuleType })
  @IsEnum(PolicyLinkModuleType)
  moduleType!: PolicyLinkModuleType;

  @ApiProperty({ enum: PolicyLinkScope })
  @IsEnum(PolicyLinkScope)
  scope!: PolicyLinkScope;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  recordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sectionKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class ApplicablePoliciesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'DOMICILIARY' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceTypeCode?: string;

  @ApiPropertyOptional({ enum: PolicyLinkModuleType })
  @IsOptional()
  @IsEnum(PolicyLinkModuleType)
  moduleType?: PolicyLinkModuleType;

  @ApiPropertyOptional({ enum: PolicyLinkScope })
  @IsOptional()
  @IsEnum(PolicyLinkScope)
  scope?: PolicyLinkScope;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  recordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sectionKey?: string;
}

export class UpdatePolicyDto extends PartialType(CreatePolicyDto) {}

export class PolicyCommentsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comments?: string;
}

export class PublishPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeSummary?: string;
}

export class CreatePolicyVersionDto {
  @ApiPropertyOptional({ enum: ['minor', 'major'], default: 'minor' })
  @IsOptional()
  @IsIn(['minor', 'major'])
  bump?: 'minor' | 'major';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeSummary?: string;

  @ApiPropertyOptional({
    description: 'When false, the new draft starts without copied editor content or a copied source file',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  reusePreviousContent?: boolean;
}

export class CreatePolicyCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class UpdatePolicyCategoryDto extends PartialType(CreatePolicyCategoryDto) {}

export class PolicyCategoryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class PolicyTagListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePolicyTagDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdatePolicyTagDto extends PartialType(CreatePolicyTagDto) {}
