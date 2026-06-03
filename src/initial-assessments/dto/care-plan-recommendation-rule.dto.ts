import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CarePlanRuleConditionWhen } from '../initial-assessment-care-plan-rules.types';

const CONDITION_WHEN = [
  'yes',
  'no',
  'answered',
  'not_answered',
  'select_equals',
  'text_contains',
] as const;

export class CarePlanRuleConditionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fieldKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  questionTextContains?: string;

  @ApiProperty({ enum: CONDITION_WHEN })
  @IsEnum(CONDITION_WHEN)
  when!: CarePlanRuleConditionWhen;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  value?: string;
}

export class CreateCarePlanRecommendationRuleDto {
  @ApiProperty()
  @IsUUID()
  carePathwayFormId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['ANY', 'ALL'] })
  @IsOptional()
  @IsEnum(['ANY', 'ALL'])
  matchMode?: 'ANY' | 'ALL';

  @ApiProperty({ type: [CarePlanRuleConditionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CarePlanRuleConditionDto)
  conditions!: CarePlanRuleConditionDto[];

  @ApiPropertyOptional({ description: 'Hide legacy area-based recommendation when this rule matches' })
  @IsOptional()
  @IsString()
  suppressLegacyArea?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCarePlanRecommendationRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carePathwayFormId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['ANY', 'ALL'] })
  @IsOptional()
  @IsEnum(['ANY', 'ALL'])
  matchMode?: 'ANY' | 'ALL';

  @ApiPropertyOptional({ type: [CarePlanRuleConditionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CarePlanRuleConditionDto)
  conditions?: CarePlanRuleConditionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  suppressLegacyArea?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
