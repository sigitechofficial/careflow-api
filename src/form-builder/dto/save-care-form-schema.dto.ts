import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormFieldType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateNested,
  buildMessage,
  type ValidationOptions,
} from 'class-validator';

/** Lowercase snake_case business key (optional). */
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Client-side reference for a row that does not exist yet (e.g. `tmp-…`). Lets a
 * show-when rule on one new field point at another new field in the same save; the
 * server swaps it for the real id. Never persisted.
 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Operators understood by every renderer (admin, carer app, supervision). */
export const CONDITIONAL_OPERATORS = [
  'equals',
  'not_equals',
  'is_true',
  'is_false',
  'includes',
] as const;
export type ConditionalOperator = (typeof CONDITIONAL_OPERATORS)[number];

export const MAX_SHOW_WHEN_RULES = 10;
export const MAX_VALIDATION_JSON_LENGTH = 4000;

/** Rejects JSON objects whose serialised form exceeds `max` characters. */
function MaxJsonLength(max: number, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'maxJsonLength',
      constraints: [max],
      validator: {
        validate: (value: unknown) => {
          if (value === null || value === undefined) return true;
          try {
            return JSON.stringify(value).length <= max;
          } catch {
            return false;
          }
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must serialise to at most $constraint1 characters`,
          options,
        ),
      },
    },
    options,
  );
}

export class FieldConditionalRuleDto {
  @ApiProperty({
    description:
      "Section of the controlling field. Normalised on save to the field's actual section (a new section's temporary id is fine).",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sectionId!: string;

  @ApiProperty({
    description:
      'Id (or clientId, for a field added in this save) of the controlling field',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  fieldId!: string;

  @ApiProperty({ enum: CONDITIONAL_OPERATORS })
  @IsIn(CONDITIONAL_OPERATORS)
  operator!: ConditionalOperator;

  @ApiPropertyOptional({
    description: 'Comparison value for equals / not_equals / includes',
  })
  // Bypass the global implicit conversion (which would turn {} into "[object Object]")
  // so non-string values are rejected rather than silently stringified.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string;
}

export class FieldConditionalLogicDto {
  @ApiProperty({
    type: [FieldConditionalRuleDto],
    description:
      'All rules must match for the field to be shown. Empty = always shown.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_SHOW_WHEN_RULES)
  @ValidateNested({ each: true })
  @Type(() => FieldConditionalRuleDto)
  showWhen!: FieldConditionalRuleDto[];
}

export class SaveCareFormFieldDto {
  @ApiPropertyOptional({
    description:
      'Existing field id (kept on save so saved answers keyed `sectionId:fieldId` stay attached). Omit for new fields.',
  })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiPropertyOptional({
    description:
      'Temporary client reference for a NEW field, so show-when rules in the same save can point at it. Not persisted.',
    example: 'tmp-3f9c2a',
  })
  @IsOptional()
  @IsString()
  @Matches(CLIENT_ID_PATTERN, {
    message: 'clientId must be 1-64 letters, digits, _ or -',
  })
  clientId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  label!: string;

  @ApiPropertyOptional({
    description:
      'Stable business key for IA → care plan mapping (e.g. hsp_personal_care_tasks)',
    example: 'hsp_personal_care_tasks',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(FIELD_KEY_PATTERN, {
    message: 'fieldKey must be lowercase snake_case starting with a letter',
  })
  fieldKey?: string;

  @ApiProperty({ enum: CarePathwayFormFieldType })
  @IsEnum(CarePathwayFormFieldType)
  fieldType!: CarePathwayFormFieldType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  placeholder?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  helpText?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  optionsJson?: unknown;

  @ApiPropertyOptional({
    type: FieldConditionalLogicDto,
    nullable: true,
    description:
      'Show-when rules. Omit to keep the stored rules, send null to clear them. Rules may only reference fields included in this save.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FieldConditionalLogicDto)
  conditionalLogicJson?: FieldConditionalLogicDto | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Field validation settings (JSON object). Omit to keep the stored value, send null to clear it.',
  })
  @IsOptional()
  @IsObject()
  @MaxJsonLength(MAX_VALIDATION_JSON_LENGTH)
  validationJson?: Record<string, unknown> | null;

  @ApiProperty({ default: 0 })
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class SaveCareFormSectionDto {
  @ApiPropertyOptional({
    description: 'Existing section id; omit for new sections',
  })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ default: 0 })
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ type: [SaveCareFormFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCareFormFieldDto)
  fields!: SaveCareFormFieldDto[];
}

export class SaveCareFormSchemaDto {
  @ApiProperty({ type: [SaveCareFormSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveCareFormSectionDto)
  sections!: SaveCareFormSectionDto[];
}
