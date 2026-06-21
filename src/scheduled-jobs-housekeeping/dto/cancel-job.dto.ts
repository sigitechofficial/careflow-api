import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  VisitCancellationReasonCode,
  VisitChargeDecision,
} from '@prisma/client';

export class CancelJobDto {
  @ApiProperty({ enum: VisitCancellationReasonCode })
  @IsEnum(VisitCancellationReasonCode)
  reasonCode!: VisitCancellationReasonCode;

  @ApiPropertyOptional({ description: 'Additional detail — required for OTHER reason' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reasonNotes?: string;

  @ApiProperty({
    enum: ['CANCELLED', 'CALLED_OFF'],
    description: 'CANCELLED = planned stop; CALLED_OFF = visit due but did not happen',
  })
  @IsIn(['CANCELLED', 'CALLED_OFF'])
  outcome!: 'CANCELLED' | 'CALLED_OFF';

  @ApiProperty({ description: 'Coordinator confirmed welfare / risk review' })
  @IsBoolean()
  welfareChecked!: boolean;

  @ApiProperty({ description: 'Client, family, or representative notified' })
  @IsBoolean()
  familyNotified!: boolean;

  @ApiProperty({ description: 'Commissioner / funder notified (if applicable)' })
  @IsBoolean()
  commissionerNotified!: boolean;

  @ApiProperty({ enum: VisitChargeDecision })
  @IsEnum(VisitChargeDecision)
  chargeDecision!: VisitChargeDecision;

  @ApiPropertyOptional({ description: 'Finance / billing notes' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  chargeDecisionNotes?: string;

  @ApiPropertyOptional({ description: 'Legacy free-text notes (appended to audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
