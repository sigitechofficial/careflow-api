import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Delete a closed survey anyway when its CQC evidence could not be taken (company-wide Admin only). The reason is
 * checked (5–300 characters, trimmed) by SurveysService.removeWithoutEvidence and kept in the audit trail.
 */
export class DeleteWithoutEvidenceDto {
  @ApiProperty({ minLength: 5, maxLength: 300, description: 'Why the survey is being deleted without CQC evidence.' })
  @IsString()
  @MaxLength(400)
  reason!: string;
}
