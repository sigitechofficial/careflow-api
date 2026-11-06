import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

  @ApiPropertyOptional({ enum: ['SERVICE_USER', 'AGENCY', 'OTHER'], description: 'Who asked for the cancellation' })
  @IsOptional()
  @IsIn(['SERVICE_USER', 'AGENCY', 'OTHER'])
  cancelledByParty?: 'SERVICE_USER' | 'AGENCY' | 'OTHER';

  @ApiPropertyOptional({ description: 'Required when cancelledByParty is OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cancelledByDescription?: string;

  @ApiPropertyOptional({ enum: ['ROTA', 'VISIT_PLAN'] })
  @IsOptional()
  @IsIn(['ROTA', 'VISIT_PLAN'])
  cancellationSource?: 'ROTA' | 'VISIT_PLAN';

  @ApiPropertyOptional({ description: 'Hours between recording the cancellation and the planned visit start' })
  @IsOptional()
  @IsNumber()
  noticeHours?: number;

  @ApiPropertyOptional({ enum: VisitChargeDecision, description: 'What the cancellation policy suggested' })
  @IsOptional()
  @IsEnum(VisitChargeDecision)
  suggestedChargeDecision?: VisitChargeDecision;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  suggestedChargePercent?: number;

  @ApiPropertyOptional({ description: 'Copy of the policy rule that was applied' })
  @IsOptional()
  @IsObject()
  policySnapshot?: Record<string, unknown>;
}

export class CancellationPolicyQueryDto {
  @ApiProperty({ enum: VisitCancellationReasonCode })
  @IsEnum(VisitCancellationReasonCode)
  reasonCode!: VisitCancellationReasonCode;
}

export class ChangeCancellationBillingDto {
  @ApiProperty({ enum: VisitChargeDecision })
  @IsEnum(VisitChargeDecision)
  chargeDecision!: VisitChargeDecision;

  @ApiProperty({ description: 'Why the decision changed (required, kept in the audit log)' })
  @IsString()
  @MaxLength(4000)
  note!: string;
}
