import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
} from 'class-validator';

export const VISIT_CREATION_MODES = ['AUTOMATIC', 'CUSTOM'] as const;
export type VisitCreationMode = (typeof VISIT_CREATION_MODES)[number];

export const VISIT_CREATION_RUN_OUTCOMES = [
  'SUCCESS',
  'PARTIAL',
  'FAILED',
] as const;
export type VisitCreationRunOutcome =
  (typeof VISIT_CREATION_RUN_OUTCOMES)[number];

/** Start of a Visit Creation run (Scripts page): checked and audited before any visit is touched. */
export class StartVisitCreationRunDto {
  @ApiProperty({ enum: VISIT_CREATION_MODES })
  @IsIn(VISIT_CREATION_MODES)
  mode!: VisitCreationMode;

  @ApiProperty({ description: 'A check only (previews, nothing saved)' })
  @IsBoolean()
  dryRun!: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'CUSTOM: the selected service users',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  serviceUserIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'CUSTOM: the selected carers',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  carerIds?: string[];
}

/** End of a run: its outcome and the per-service-user result shown on the page. */
export class FinishVisitCreationRunDto {
  @ApiProperty({ enum: VISIT_CREATION_RUN_OUTCOMES })
  @IsIn(VISIT_CREATION_RUN_OUTCOMES)
  outcome!: VisitCreationRunOutcome;

  @ApiProperty({
    description:
      'Counts and per-service-user outcome (no personal details beyond names/numbers)',
  })
  @IsObject()
  summary!: Record<string, unknown>;
}
