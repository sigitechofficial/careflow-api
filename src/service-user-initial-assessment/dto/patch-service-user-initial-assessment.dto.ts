import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PatchServiceUserInitialAssessmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  numberOfCarers?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  likesToBeKnownAs?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  doorCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  accessRisks?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  accessInstruction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  reasonForAdmission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  previousMedicalHistory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  careInstructions?: string;

  /**
   * JSON string of `Record<string, boolean>` (checkbox state). Sent as a string so Nest's
   * global `whitelist: true` does not strip dynamic nested keys under `checklist`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2_500_000)
  checklistJson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  culturalReligiousNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  careCarerNumbersNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  additionalRisksNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  environmentAccessHazardsNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  hydrationComment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  nutritionComment?: string;
}
