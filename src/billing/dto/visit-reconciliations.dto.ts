import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VisitReconciliationStatus } from '@prisma/client';

export class VisitReconciliationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: VisitReconciliationStatus })
  @IsOptional()
  @IsEnum(VisitReconciliationStatus)
  status?: VisitReconciliationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasExceptions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Scope to service users at this location (branch)',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by visit-plan night duty: overnight (sleeping+waking), SLEEPING_NIGHT, WAKING_NIGHT, or standard',
    enum: ['overnight', 'SLEEPING_NIGHT', 'WAKING_NIGHT', 'standard'],
  })
  @IsOptional()
  @IsIn(['overnight', 'SLEEPING_NIGHT', 'WAKING_NIGHT', 'standard', 'NONE'])
  nightDuty?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class UpdateVisitReconciliationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedPayStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedPayEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedBillStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  approvedBillEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;

  @ApiPropertyOptional({ description: 'Approved travel distance in miles' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  travelMiles?: number | null;

  @ApiPropertyOptional({ description: 'Approved travel time in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  travelMinutes?: number | null;

  @ApiPropertyOptional({
    description: 'Unpaid qualifying travel minutes (counts toward NMW hours, not wages)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unpaidTravelMinutes?: number | null;

  @ApiPropertyOptional({ description: 'Passenger miles for AMAP passenger supplement' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  passengerMiles?: number | null;
}

export class SetVisitPayableAmountDto {
  @ApiProperty({ example: 28.5, description: 'Manual payable amount in GBP' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  payableAmount!: number;

  @ApiPropertyOptional({ description: 'Optional note explaining the amount change' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'When true (default), accept the visit for pay so the amount counts toward salary',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  approveForPay?: boolean;
}

export class ApproveVisitReconciliationDto {
  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;

  @ApiPropertyOptional({ description: 'Allow approval despite blocking exceptions' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  managerOverride?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, set the decision exactly to this scope (authoritative) instead of ' +
      'merging with a prior approval. PAY → pay only (funder £0), INVOICE → bill only ' +
      '(carer £0), BOTH → both. Used by the three-choice approve buttons.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  exclusive?: boolean;
}

export class RejectVisitReconciliationDto {
  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  approvalNotes?: string;
}

export class DecideVisitOverrunDto {
  @ApiPropertyOptional({ description: 'Optional notes for the overrun decision' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class BulkApproveVisitReconciliationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ enum: ['PAY', 'INVOICE', 'BOTH'] })
  @IsEnum(['PAY', 'INVOICE', 'BOTH'])
  scope!: 'PAY' | 'INVOICE' | 'BOTH';
}

export class BackfillVisitReconciliationsDto {
  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class RecalculateVisitReconciliationsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'When set, only re-evaluate these reconciliation ids (unlocked rows)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ClearVisitReconciliationsDto {
  @ApiPropertyOptional({
    description:
      'When set, only delete reconciliations for this service user (and their dependent lines)',
  })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;
}
