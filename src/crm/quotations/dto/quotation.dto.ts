import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  EnquiryLostReason,
  EnquiryQuoteExtraKind,
  EnquiryQuoteFundingCategory,
  EnquiryQuoteFundingMethod,
  EnquiryQuoteFundingStatus,
  EnquiryQuotePatternFrequency,
  EnquiryQuotePayerType,
  EnquiryQuoteResponseType,
  EnquiryQuoteSendChannel,
  EnquiryQuoteType,
  EnquiryStage,
  QuotationChargeFrequency,
  VisitPlanNightDuty,
} from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class QuoteVisitPatternDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  careType?: string | null;

  @ApiProperty({ example: '08:00' })
  @Matches(HM, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiPropertyOptional({
    example: '08:45',
    description: 'At/before the start = next day.',
  })
  @IsOptional()
  @Matches(HM, { message: 'endTime must be HH:mm' })
  endTime?: string | null;

  @ApiPropertyOptional({
    example: '10:00',
    description: 'Latest start of a time window.',
  })
  @IsOptional()
  @Matches(HM, { message: 'windowEndTime must be HH:mm' })
  windowEndTime?: string | null;

  @ApiProperty({ minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @ApiProperty({ type: [Number], description: '0=Sun … 6=Sat' })
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ enum: EnquiryQuotePatternFrequency })
  @IsEnum(EnquiryQuotePatternFrequency)
  frequency!: EnquiryQuotePatternFrequency;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsDateString({}, { each: true })
  oneOffDates?: string[];

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  carersPerVisit!: number;

  @ApiPropertyOptional({ enum: VisitPlanNightDuty })
  @IsOptional()
  @IsEnum(VisitPlanNightDuty)
  nightDuty?: VisitPlanNightDuty;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  activities?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'Manual £ per visit (all carers) instead of the card rate.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  manualChargePerVisit?: number | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string | null;
}

export class QuoteFundingDto {
  @ApiProperty({ enum: EnquiryQuotePayerType })
  @IsEnum(EnquiryQuotePayerType)
  payerType!: EnquiryQuotePayerType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  payerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funderId?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string | null;

  @ApiProperty({ enum: EnquiryQuoteFundingMethod })
  @IsEnum(EnquiryQuoteFundingMethod)
  method!: EnquiryQuoteFundingMethod;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ enum: EnquiryQuoteFundingStatus })
  @IsOptional()
  @IsEnum(EnquiryQuoteFundingStatus)
  status?: EnquiryQuoteFundingStatus;
}

export class QuoteExtraDto {
  @ApiProperty({ enum: EnquiryQuoteExtraKind })
  @IsEnum(EnquiryQuoteExtraKind)
  kind!: EnquiryQuoteExtraKind;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  description!: string;

  @ApiProperty({ enum: QuotationChargeFrequency })
  @IsEnum(QuotationChargeFrequency)
  frequency!: QuotationChargeFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null;

  @ApiPropertyOptional({ description: 'Miles per week for MILEAGE.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quantity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPercentage?: boolean;
}

/** Draft content (create and update). Lists replace the existing ones when given. */
export class QuoteDraftDto {
  @ApiPropertyOptional({ enum: EnquiryQuoteType })
  @IsOptional()
  @IsEnum(EnquiryQuoteType)
  quoteType?: EnquiryQuoteType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  proposedStartDate?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  proposedEndDate?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @ApiPropertyOptional({ example: 'GBP' })
  @IsOptional()
  @IsIn(['GBP'])
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assessmentSubmissionId?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assessmentReference?: string | null;

  @ApiPropertyOptional({ enum: EnquiryQuoteFundingCategory })
  @IsOptional()
  @IsEnum(EnquiryQuoteFundingCategory)
  fundingCategory?: EnquiryQuoteFundingCategory;

  @ApiPropertyOptional({
    description: 'Client charge card; empty = picked automatically.',
  })
  @IsOptional()
  @IsUUID()
  chargeCardId?: string | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNotes?: string | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  clientNotes?: string | null;

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  terms?: string | null;

  @ApiPropertyOptional({ type: [QuoteVisitPatternDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuoteVisitPatternDto)
  patterns?: QuoteVisitPatternDto[];

  @ApiPropertyOptional({ type: [QuoteFundingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuoteFundingDto)
  fundings?: QuoteFundingDto[];

  @ApiPropertyOptional({ type: [QuoteExtraDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => QuoteExtraDto)
  extras?: QuoteExtraDto[];
}

export class QuoteNoteDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class SendQuoteDto {
  @ApiProperty({
    enum: EnquiryQuoteSendChannel,
    description: 'EMAIL sends now; others record a send done outside CareFlow.',
  })
  @IsEnum(EnquiryQuoteSendChannel)
  channel!: EnquiryQuoteSendChannel;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  @ApiPropertyOptional({
    description: 'External send: when it was sent (defaults to now).',
  })
  @IsOptional()
  @IsDateString()
  sentAt?: string;

  @ApiPropertyOptional({ description: 'Creates a follow-up due then.' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiProperty({
    description:
      'Unique per send attempt; repeating it returns the first result.',
  })
  @IsString()
  @MaxLength(100)
  idempotencyKey!: string;
}

export class RecordResponseDto {
  @ApiProperty({ enum: EnquiryQuoteResponseType })
  @IsEnum(EnquiryQuoteResponseType)
  responseType!: EnquiryQuoteResponseType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  responderName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  responderRelationship?: string;

  @ApiPropertyOptional({ maxLength: 60, example: 'Phone' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  respondedAt?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  details?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidence?: string;

  @ApiPropertyOptional({
    enum: EnquiryLostReason,
    description: 'Required for DECLINED.',
  })
  @IsOptional()
  @IsEnum(EnquiryLostReason)
  declineReasonCode?: EnquiryLostReason;

  @ApiPropertyOptional({
    description: 'DECLINED: also mark the enquiry Lost (default true).',
  })
  @IsOptional()
  @IsBoolean()
  markEnquiryLost?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nextAction?: string;

  @ApiPropertyOptional({ description: 'Creates a follow-up due then.' })
  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

export class CreateFollowUpDto {
  @ApiProperty()
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ maxLength: 60, example: 'Phone' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class UpdateFollowUpDto {
  @ApiProperty({ enum: ['COMPLETE', 'RESCHEDULE', 'CANCEL'] })
  @IsIn(['COMPLETE', 'RESCHEDULE', 'CANCEL'])
  action!: 'COMPLETE' | 'RESCHEDULE' | 'CANCEL';

  @ApiPropertyOptional({ description: 'RESCHEDULE: new due date.' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  outcome?: string;
}

export class ReconcileLegacyQuoteDto {
  @ApiProperty({
    enum: ['ACKNOWLEDGE', 'MOVE_STAGE'],
    description:
      'ACKNOWLEDGE keeps the stage; MOVE_STAGE moves the enquiry back.',
  })
  @IsIn(['ACKNOWLEDGE', 'MOVE_STAGE'])
  action!: 'ACKNOWLEDGE' | 'MOVE_STAGE';

  @ApiPropertyOptional({
    enum: [EnquiryStage.NEW, EnquiryStage.CONTACTED, EnquiryStage.ASSESSMENT],
  })
  @IsOptional()
  @IsIn([EnquiryStage.NEW, EnquiryStage.CONTACTED, EnquiryStage.ASSESSMENT])
  stage?: EnquiryStage;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  note!: string;
}
