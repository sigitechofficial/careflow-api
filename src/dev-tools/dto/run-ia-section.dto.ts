import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';

/** QA demo severity scenarios. */
export const IA_AUTOFILL_LEVELS = ['low', 'normal', 'critical'] as const;
export type IaAutofillLevelDto = (typeof IA_AUTOFILL_LEVELS)[number];

/** Number of holistic document tabs (1..18). Mirrors the frontend HOLISTIC_TAB_COUNT. */
export const IA_HOLISTIC_TAB_COUNT = 18;

/**
 * Section-scoped QA demo population. The frontend is the source of truth for "what this tab
 * shows" and passes the exact `questionIds` it renders (the backend still validates membership
 * and excludes profile/secure fields). `tabId` selects the tab's own `submission.metadata`
 * sub-key(s) for tool tabs.
 */
export class RunIaSectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceUserId!: string;

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
}
