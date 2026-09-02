import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsUUID, Min } from 'class-validator';
import {
  IA_REGISTERED_HOLISTIC_TAB_IDS,
} from '../../../prisma/seed-lib/ia-registered-holistic-tab-ids';

export {
  IA_REGISTERED_HOLISTIC_TAB_IDS,
  IA_HOLISTIC_TAB_COUNT,
  IA_MAX_HOLISTIC_TAB_ID,
  isRegisteredHolisticTabId,
  type IaRegisteredHolisticTabId,
} from '../../../prisma/seed-lib/ia-registered-holistic-tab-ids';

/** QA demo severity scenarios. */
export const IA_AUTOFILL_LEVELS = ['low', 'normal', 'critical'] as const;
export type IaAutofillLevelDto = (typeof IA_AUTOFILL_LEVELS)[number];

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

  @ApiProperty({ description: 'Registered holistic document tab id (1–18 frozen; 19 PEEP, 20 bed rails, 21 infection, 22 fire)' })
  @IsInt()
  @Min(1)
  @IsIn([...IA_REGISTERED_HOLISTIC_TAB_IDS])
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
    addressLine1?: string;
    addressLine2?: string;
    town?: string;
    county?: string;
    postcode?: string;
    phone?: string;
    mobile?: string;
    email?: string;
    gpContact?: string;
    gpName?: string;
    gpPhone?: string;
    gpPractice?: string;
    emergencyContact?: string;
    allergies?: string;
    accessInstruction?: string;
  };
}
