import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  QuotationChargeFrequency,
  QuotationPayerType,
  ReferralPriority,
  ReferralReceivedVia,
  ReferralSourceType,
  ReferralStatus,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { QuotationAction } from '../referral-workflow.util';

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// ------------------------------------------------------------------ referrals

export class CreateReferralDto {
  @ApiProperty({ enum: ReferralSourceType })
  @IsEnum(ReferralSourceType)
  sourceType!: ReferralSourceType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referringOrganisation?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referrerName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referrerRole?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referrerPhone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @ValidateIf((_o, v) => typeof v === 'string' && v.trim() !== '')
  @IsEmail()
  @MaxLength(200)
  referrerEmail?: string;

  @ApiPropertyOptional({ description: 'Date/time on the referral (ISO)' })
  @IsOptional()
  @IsDateString()
  referralDate?: string | null;

  @ApiProperty({ description: 'When it reached us (ISO)' })
  @IsDateString()
  receivedAt!: string;

  @ApiPropertyOptional({ enum: ReferralReceivedVia })
  @IsOptional()
  @IsEnum(ReferralReceivedVia)
  receivedVia?: ReferralReceivedVia;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  receivedByEmployeeId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Assigned branch' })
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  responsibleEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: ReferralPriority })
  @IsOptional()
  @IsEnum(ReferralPriority)
  priority?: ReferralPriority;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  careRequirements?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  expectedStartDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(168)
  requestedHoursPerWeek?: number | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Funding arrangement (FundingType); empty = to be confirmed',
  })
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'Funding organisation' })
  @IsOptional()
  @IsUUID()
  funderId?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fundingNotes?: string;

  @ApiPropertyOptional({ description: 'Next follow-up (ISO)' })
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateReferralDto extends PartialType(CreateReferralDto) {}

export class ReferralStatusDto {
  @ApiProperty({ enum: ReferralStatus })
  @IsEnum(ReferralStatus)
  status!: ReferralStatus;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Required for decline and reopen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ReferralFollowUpDto {
  @ApiProperty({ maxLength: 2000, description: 'What was done / agreed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({ description: 'Next follow-up (ISO); omit to clear' })
  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;
}

export class ReferralNoteDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}

// ------------------------------------------------------------------ quotations

export class QuotationLineDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @ApiPropertyOptional({ type: [String], description: 'MON..SUN' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn(DAY_CODES, { each: true })
  daysOfWeek?: string[];

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(70)
  visitsPerWeek!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  numberOfCarers!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  hourlyRate!: number;
}

export class QuotationChargeDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  amount!: number;

  @ApiProperty({ enum: QuotationChargeFrequency })
  @IsEnum(QuotationChargeFrequency)
  frequency!: QuotationChargeFrequency;
}

export class CreateQuotationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referralId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Care package (visit plan)',
  })
  @IsOptional()
  @IsUUID()
  visitPlanId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  responsibleEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: QuotationPayerType })
  @IsOptional()
  @IsEnum(QuotationPayerType)
  payerType?: QuotationPayerType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  payerName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  payerRelationship?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @ValidateIf((_o, v) => typeof v === 'string' && v.trim() !== '')
  @IsEmail()
  @MaxLength(200)
  payerEmail?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  payerPhone?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  payerAddress?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @ApiPropertyOptional({ description: 'Proposed start (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  terms?: string;

  @ApiPropertyOptional({ type: [QuotationLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines?: QuotationLineDto[];

  @ApiPropertyOptional({ type: [QuotationChargeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => QuotationChargeDto)
  charges?: QuotationChargeDto[];
}

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}

const QUOTATION_ACTIONS: QuotationAction[] = [
  'SEND',
  'ACCEPT',
  'DECLINE',
  'WITHDRAW',
];

export class QuotationStatusDto {
  @ApiProperty({ enum: QUOTATION_ACTIONS })
  @IsIn(QUOTATION_ACTIONS)
  action!: QuotationAction;

  @ApiPropertyOptional({
    description: 'When it happened (ISO); now if omitted',
  })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'ACCEPT: who accepted' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  acceptedByName?: string;

  @ApiPropertyOptional({
    maxLength: 50,
    description: 'ACCEPT: signed form, email, verbal, portal…',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  acceptanceMethod?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'DECLINE / WITHDRAW reason, or a note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ReviseQuotationDto {
  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Why it is being revised',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
