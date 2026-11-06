import { ApiProperty } from '@nestjs/swagger';
import { ReviewAudience, ReviewScheduleKind } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/** Settings → Supervision: the Care Pathway staff form a review type is recorded on. */
export class SetSupervisionFormDto {
  @ApiProperty({ nullable: true, description: 'Published Care Pathway staff form; null removes it.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  formId!: string | null;
}

/** The carer's named supervisor (gets their supervision reminders). */
export class SetEmployeeSupervisorDto {
  @ApiProperty({ nullable: true, description: 'User who supervises this carer; null clears it.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  supervisorUserId!: string | null;
}

/** Settings → Supervision → Review types: when a review type is due and who for. */
export class SetReviewScheduleDto {
  @ApiProperty({ enum: ReviewScheduleKind })
  @IsEnum(ReviewScheduleKind)
  scheduleKind!: ReviewScheduleKind;

  @ApiProperty({
    nullable: true,
    description: 'REPEATING: days between reviews. EVENT: follow-up gap once one is recorded (optional).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  defaultIntervalDays!: number | null;

  @ApiProperty({ nullable: true, description: 'REPEATING: first due this many days after the start date (null = the interval).' })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(3650)
  firstDueAfterStartDays!: number | null;

  @ApiProperty({ type: [Number], description: 'MILESTONES: days after the start date, e.g. 30, 90, 180.' })
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3650, { each: true })
  milestoneDays!: number[];

  @ApiProperty({ enum: ReviewAudience })
  @IsEnum(ReviewAudience)
  audience!: ReviewAudience;
}
