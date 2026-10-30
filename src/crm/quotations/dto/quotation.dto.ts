import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  EnquiryLostReason,
  EnquiryQuoteClientLayout,
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

export class QuoteShortVisitRateDto {
  @ApiProperty({
    description: 'Visits up to this many minutes use this price.',
  })
  @IsInt()
  @Min(1)
  @Max(240)
  upToMinutes!: number;

  @ApiProperty({ description: '£ per visit per carer.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pricePerVisit!: number;
}

export class QuoteDayRateDto {
  @ApiProperty({
    enum: ['PERCENT', 'HOURLY'],
    description:
      '% on top of the visit price, or an hourly rate in place of the standard one.',
  })
  @IsIn(['PERCENT', 'HOURLY'])
  mode!: 'PERCENT' | 'HOURLY';

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  value!: number;
}

/** The quote's other rates; all optional. */
export class QuoteRatesDto {
  @ApiPropertyOptional({ type: [QuoteShortVisitRateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => QuoteShortVisitRateDto)
  shortVisits?: QuoteShortVisitRateDto[];

  @ApiPropertyOptional({
    type: QuoteDayRateDto,
    description: 'Saturday and Sunday.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteDayRateDto)
  weekend?: QuoteDayRateDto | null;

  @ApiPropertyOptional({
    type: QuoteDayRateDto,
    description: 'Replaces the weekend rate on a bank holiday.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteDayRateDto)
  bankHoliday?: QuoteDayRateDto | null;

  @ApiPropertyOptional({ description: '£ per sleeping night per carer.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sleepingNightPrice?: number | null;

  @ApiPropertyOptional({
    description: '£ per carer per hour on a waking night.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wakingNightHourly?: number | null;
}

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
    description: 'Own £ per visit (all carers) instead of the hourly rate.',
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
    description:
      '£ per carer per hour; each visit = rate × length × carers (unless it has its own price).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  hourlyRate?: number | null;

  @ApiPropertyOptional({
    enum: EnquiryQuoteClientLayout,
    description:
      'DETAILED: every visit with times and prices. SUMMARY: only the total and the visits by time of day (no times).',
  })
  @IsOptional()
  @IsEnum(EnquiryQuoteClientLayout)
  clientLayout?: EnquiryQuoteClientLayout;

  @ApiPropertyOptional({
    description:
      'SUMMARY quotes: the weekly price of the visits, typed by hand (£).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  manualWeeklyTotal?: number | null;

  @ApiPropertyOptional({
    type: QuoteRatesDto,
    description: 'Short-visit, weekend, bank holiday and night rates.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteRatesDto)
  rates?: QuoteRatesDto | null;

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

export class CreateServiceUserFromQuoteDto {
  @ApiPropertyOptional({
    description:
      'Also create the draft care package from the accepted quote (default true).',
  })
  @IsOptional()
  @IsBoolean()
  createCarePackage?: boolean;
}

/** The funder's approval of an accepted quote: their funding reference and a short note. */
export class ConfirmFundingDto {
  @ApiPropertyOptional({
    maxLength: 120,
    description: "The funder's reference (e.g. council package or CHC number).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
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
