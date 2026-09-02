import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** QA demo severity scenarios. */
export const IA_AUTOFILL_LEVELS = ['low', 'normal', 'critical'] as const;
export type IaAutofillLevelDto = (typeof IA_AUTOFILL_LEVELS)[number];

/** Number of holistic document tabs (1..18). Mirrors the frontend HOLISTIC_TAB_COUNT. */
export const IA_HOLISTIC_TAB_COUNT = 18;

/**
 * Generate (no-save) severity-aware demo values for ONE holistic tab. The frontend passes the
 * exact `questionIds` the tab renders; the backend computes the values (excluding profile/secure
 * fields) and RETURNS them without persisting anything. No `serviceUserId` is needed because no
 * submission is created and nothing is written.
 */
export class GenerateIaSectionDto {
  @ApiProperty({ enum: IA_AUTOFILL_LEVELS })
  @IsIn(IA_AUTOFILL_LEVELS)
  level!: IaAutofillLevelDto;

  @ApiProperty({ minimum: 1, maximum: IA_HOLISTIC_TAB_COUNT, description: 'Holistic document tab id (1..18)' })
  @IsInt()
  @Min(1)
  @Max(IA_HOLISTIC_TAB_COUNT)
  tabId!: number;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Question IDs the tab renders (may be empty for tool-only tabs)' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  questionIds!: string[];

  @ApiPropertyOptional({
    description:
      'Existing Service User profile values. Occupied fields are never overwritten; empty identity fields receive synthetic QA values.',
  })
  @IsOptional()
  @IsObject()
  identity?: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    preferredName?: string;
    dateOfBirth?: string;
    nhsNumber?: string;
    nationalInsuranceNumber?: string;
    gender?: string;
    ethnicity?: string;
    language?: string;
    addressContact?: string;
    gpContact?: string;
    gpName?: string;
    emergencyContact?: string;
    allergies?: string;
    accessInstruction?: string;
  };
}
