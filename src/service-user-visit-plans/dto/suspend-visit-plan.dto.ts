import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SuspendVisitPlanDto {
  @ApiProperty({ description: 'Catalogued pause reason (CQC audit)' })
  @IsUUID()
  pauseReasonCatalogId!: string;

  @ApiProperty({ description: 'Free-text detail — what changed and contingency arrangements' })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'When visits are expected to resume (omit for indefinite / unknown)',
  })
  @IsOptional()
  @IsDateString()
  expectedResumeAt?: string | null;

  @ApiPropertyOptional({
    description: 'When the suspension decision should be reviewed (defaults to 7 days if omitted)',
  })
  @IsOptional()
  @IsDateString()
  reviewDueAt?: string | null;

  @ApiPropertyOptional({ description: 'Welfare checks, alternative contact, medication contingency' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  contingencyNotes?: string;

  @ApiPropertyOptional({
    description:
      'When visits should stop (YYYY-MM-DD). Defaults to today. Cannot be in the future — use Record Absences for future-dated pauses.',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({
    description: 'Required when effectiveFrom is before today — retrospective correction reason',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  retrospectiveReason?: string;

  @ApiPropertyOptional({
    description: 'When true (default), cancel scheduled visits from effectiveFrom forward',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  cancelFutureVisits?: boolean;
}

export class ActivateVisitPlanDto {
  @ApiPropertyOptional({ description: 'Reason for re-activating a suspended package' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reactivationReason?: string;

  @ApiPropertyOptional({
    description: 'When true, cancel future rota jobs from ended active package(s)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  cancelEndedPlanJobs?: boolean;
}
