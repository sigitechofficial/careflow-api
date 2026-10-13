import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SALARY_COVERAGES, SALARY_ENTRY_PERIODS, SALARY_PRORATION_METHODS } from '../salary.util';

export enum PayrollTaxYearStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

export enum PayrollPayFrequencyDto {
  WEEKLY = 'WEEKLY',
  FORTNIGHTLY = 'FORTNIGHTLY',
  FOUR_WEEKLY = 'FOUR_WEEKLY',
  MONTHLY = 'MONTHLY',
}

export enum PayrollScheduleStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum EmployeePayrollProfileStatusDto {
  DRAFT = 'DRAFT',
  READY = 'READY',
  SUSPENDED = 'SUSPENDED',
}

export enum PayrollStarterDeclarationDto {
  UNKNOWN = 'UNKNOWN',
  A_FIRST_JOB = 'A_FIRST_JOB',
  B_ONLY_JOB_THIS_YEAR = 'B_ONLY_JOB_THIS_YEAR',
  C_HAS_ANOTHER_JOB_OR_PENSION = 'C_HAS_ANOTHER_JOB_OR_PENSION',
}

export enum PayrollNiCategoryDto {
  A = 'A',
  B = 'B',
  C = 'C',
  F = 'F',
  H = 'H',
  I = 'I',
  J = 'J',
  L = 'L',
  M = 'M',
  S = 'S',
  V = 'V',
  Z = 'Z',
  X = 'X',
}

export enum PayrollTaxCodeGroupDto {
  STANDARD = 'STANDARD',
  SPECIAL = 'SPECIAL',
  SCOTLAND = 'SCOTLAND',
  WALES = 'WALES',
}

export enum EmployeePayAgreementBasisDto {
  HOURLY_CARE = 'HOURLY_CARE',
  SALARIED = 'SALARIED',
  HYBRID = 'HYBRID',
}

export enum EmployeePayAgreementStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  TERMINATED = 'TERMINATED',
}

export class CreatePayrollTaxYearDto {
  @ApiProperty({ example: '2025-26' })
  @IsString()
  @MinLength(4)
  @MaxLength(16)
  code!: string;

  @ApiProperty({ example: 'Tax year 2025-26' })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ example: '2025-04-06' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-04-05' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdatePayrollTaxYearDto extends PartialType(CreatePayrollTaxYearDto) {
  @ApiPropertyOptional({ enum: PayrollTaxYearStatusDto })
  @IsOptional()
  @IsEnum(PayrollTaxYearStatusDto)
  status?: PayrollTaxYearStatusDto;
}

export class CreatePayrollTaxCodeDto {
  @ApiProperty({ example: '1257L' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @ApiProperty({ example: '1257L — Personal allowance (standard)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ enum: PayrollTaxCodeGroupDto })
  @IsOptional()
  @IsEnum(PayrollTaxCodeGroupDto)
  group?: PayrollTaxCodeGroupDto;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayrollTaxCodeDto extends PartialType(CreatePayrollTaxCodeDto) {}

export class UpdatePayrollStatutoryRatesDto {
  @ApiPropertyOptional({ example: 12570 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  personalAllowanceAnnual?: number;

  @ApiPropertyOptional({ example: 37700 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basicRateBandAnnual?: number;

  @ApiPropertyOptional({ example: 50270 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  higherRateThresholdAnnual?: number;

  @ApiPropertyOptional({ example: 125140 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  additionalRateThresholdAnnual?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  basicRatePercent?: number;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  higherRatePercent?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  additionalRatePercent?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  niEmployeeRateMainPercent?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  niEmployeeRateUpperPercent?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  niEmployerRatePercent?: number;

  @ApiPropertyOptional({ example: 129 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niLelWeekly?: number;

  @ApiPropertyOptional({ example: 242 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niPtWeekly?: number;

  @ApiPropertyOptional({ example: 96 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niStWeekly?: number;

  @ApiPropertyOptional({ example: 967 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niUelWeekly?: number;

  @ApiPropertyOptional({ example: 559 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niLelMonthly?: number;

  @ApiPropertyOptional({ example: 1048 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niPtMonthly?: number;

  @ApiPropertyOptional({ example: 417 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niStMonthly?: number;

  @ApiPropertyOptional({ example: 4189 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  niUelMonthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceNote?: string | null;
}

export class CreatePayrollScheduleDto {
  @ApiProperty({ example: 'Monthly carers' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'MONTHLY_CARERS' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @ApiProperty({ enum: PayrollPayFrequencyDto })
  @IsEnum(PayrollPayFrequencyDto)
  frequency!: PayrollPayFrequencyDto;

  @ApiPropertyOptional({ description: '1–7 weekdays for weekly-style; 1–31 for monthly pay day (clamped to month length)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  anchorDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdatePayrollScheduleDto extends PartialType(CreatePayrollScheduleDto) {
  @ApiPropertyOptional({ enum: PayrollScheduleStatusDto })
  @IsOptional()
  @IsEnum(PayrollScheduleStatusDto)
  status?: PayrollScheduleStatusDto;
}

export class GeneratePayrollPeriodsDto {
  @ApiProperty({ description: 'PayrollTaxYear id' })
  @IsUUID()
  taxYearId!: string;

  @ApiPropertyOptional({
    description:
      'When true, replace existing periods for this schedule and tax year if none have payroll runs attached.',
  })
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}

export class UpsertEmployeePayrollProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleId?: string | null;

  @ApiPropertyOptional({ enum: EmployeePayrollProfileStatusDto })
  @IsOptional()
  @IsEnum(EmployeePayrollProfileStatusDto)
  status?: EmployeePayrollProfileStatusDto;

  @ApiPropertyOptional({ example: '1257L' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  taxCodeWeek1Month1?: boolean;

  @ApiPropertyOptional({ enum: PayrollNiCategoryDto })
  @IsOptional()
  @IsEnum(PayrollNiCategoryDto)
  niCategory?: PayrollNiCategoryDto | null;

  @ApiPropertyOptional({ enum: PayrollStarterDeclarationDto })
  @IsOptional()
  @IsEnum(PayrollStarterDeclarationDto)
  starterDeclaration?: PayrollStarterDeclarationDto;

  @ApiPropertyOptional({
    enum: ['A', 'B', 'C', 'D', 'E'],
    description: 'HMRC FPS hours-normally-worked band (A–E)',
  })
  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D', 'E'])
  hoursNormallyWorked?: 'A' | 'B' | 'C' | 'D' | 'E' | null;

  @ApiPropertyOptional({
    description: 'Previous employer P45 received — starter A/B/C statement not required',
  })
  @IsOptional()
  @IsBoolean()
  p45Received?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studentLoanPlan1?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studentLoanPlan2?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studentLoanPlan4?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  studentLoanPlan5?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  postgraduateLoan?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pensionOptedIn?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'UK 2026/27 configurable deduction catalogue codes',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deductionElections?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  pensionSchemeRef?: string | null;

  @ApiPropertyOptional({ example: '12-34-56' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  bankSortCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankAccountNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankAccountName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateEmployeePayAgreementDto {
  @ApiProperty({ enum: EmployeePayAgreementBasisDto })
  @IsEnum(EmployeePayAgreementBasisDto)
  basis!: EmployeePayAgreementBasisDto;

  @ApiProperty({ example: '2026-04-06' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleId?: string | null;

  @ApiPropertyOptional({ description: 'Billing PayCard UUID (optional reference)' })
  @IsOptional()
  @IsUUID()
  payCardId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  annualSalary?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(168)
  contractedHours?: number | null;

  @ApiPropertyOptional({ enum: SALARY_ENTRY_PERIODS, description: 'How the salary is entered' })
  @IsOptional()
  @IsIn(SALARY_ENTRY_PERIODS as unknown as string[])
  salaryEntryPeriod?: string | null;

  @ApiPropertyOptional({ description: 'Salary per year, month or week, as salaryEntryPeriod says' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  salaryEntryAmount?: number | null;

  @ApiPropertyOptional({ enum: SALARY_PRORATION_METHODS, description: 'How a part period is paid' })
  @IsOptional()
  @IsIn(SALARY_PRORATION_METHODS as unknown as string[])
  salaryProrationMethod?: string | null;

  @ApiPropertyOptional({ enum: SALARY_COVERAGES, description: 'What work the salary already pays for' })
  @IsOptional()
  @IsIn(SALARY_COVERAGES as unknown as string[])
  salaryCoverage?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(10_000)
  hourlyRateOverride?: number | null;

  @ApiPropertyOptional({ enum: EmployeePayAgreementStatusDto })
  @IsOptional()
  @IsEnum(EmployeePayAgreementStatusDto)
  status?: EmployeePayAgreementStatusDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateEmployeePayAgreementDto extends PartialType(CreateEmployeePayAgreementDto) {}

export class CancelUkPayrollRunDto {
  @ApiPropertyOptional({ description: 'Why the run is being cancelled (kept in the audit log)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateUkPayrollRunDto {
  @ApiProperty()
  @IsUUID()
  periodId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class EnrolUkPayrollRunDto {
  @ApiPropertyOptional({
    description: 'Employee IDs to enrol. If omitted, enrols all READY profiles on the run schedule.',
    type: [String],
  })
  @IsOptional()
  @IsUUID('4', { each: true })
  employeeIds?: string[];
}

export class PayrollPeriodsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taxYearId?: string;
}

export class DeletePayrollPeriodsDto {
  @ApiProperty({ description: 'Pay schedule id — required with taxYearId to delete a set of periods' })
  @IsUUID()
  scheduleId!: string;

  @ApiProperty({ description: 'Tax year id — required with scheduleId to delete a set of periods' })
  @IsUUID()
  taxYearId!: string;
}

export class PurgePayrollDataDto {
  @ApiProperty({
    description: 'Must equal DELETE ALL PAYROLL to confirm irreversible wipe of payroll schema data',
    example: 'DELETE ALL PAYROLL',
  })
  @IsString()
  @Matches(/^DELETE ALL PAYROLL$/)
  confirm!: string;
}

/** Org-level HMRC employer identity used on every FPS/EPS (T01). */
export class UpdatePayrollEmployerSettingsDto {
  @ApiPropertyOptional({
    example: '123',
    description: 'HMRC office number — first 3 digits of the Employer PAYE reference',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}$/, { message: 'hmrcOfficeNumber must be exactly 3 digits' })
  hmrcOfficeNumber?: string | null;

  @ApiPropertyOptional({
    example: 'AB45678',
    description: 'Employer PAYE reference after the slash',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  employerPayeReference?: string | null;

  @ApiPropertyOptional({
    example: '123PA00012345',
    description: 'Accounts Office reference from the HMRC registration letter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  accountsOfficeReference?: string | null;

  @ApiPropertyOptional({ example: 'London' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  taxDistrict?: string | null;

  @ApiPropertyOptional({ example: 'Care Services Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  employerTradingName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], example: 'TEST' })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  activeHmrcEnvironment?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({
    example: 'my-gateway-user',
    description: 'HMRC PAYE Online Gateway user ID (test environment)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gatewayTestUserId?: string | null;

  @ApiPropertyOptional({
    description:
      'New Gateway password for test. Omit or leave blank to keep the stored password. Never returned on GET.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gatewayTestPassword?: string | null;

  @ApiPropertyOptional({ description: 'Clear stored test Gateway password' })
  @IsOptional()
  @IsBoolean()
  clearTestPassword?: boolean;

  @ApiPropertyOptional({
    example: 'my-live-gateway-user',
    description: 'HMRC PAYE Online Gateway user ID (live environment)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gatewayLiveUserId?: string | null;

  @ApiPropertyOptional({
    description:
      'New Gateway password for live. Omit or leave blank to keep the stored password. Never returned on GET.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gatewayLivePassword?: string | null;

  @ApiPropertyOptional({ description: 'Clear stored live Gateway password' })
  @IsOptional()
  @IsBoolean()
  clearLivePassword?: boolean;

  @ApiPropertyOptional({
    description: 'Claim Employment Allowance on Employer Payment Summary (EPS) when eligible',
  })
  @IsOptional()
  @IsBoolean()
  employmentAllowanceClaimed?: boolean;
}

/** Query for Care EPS preview (T14) — not HMRC GovTalk submit. */
export class PreviewEpsQueryDto {
  @ApiPropertyOptional({
    description: 'Payroll tax year id. Defaults to the current tax year.',
  })
  @IsOptional()
  @IsUUID()
  taxYearId?: string;

  @ApiProperty({ example: 1, description: 'UK PAYE tax month 1–12 (Month 1 = 6 Apr–5 May)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth!: number;

  @ApiPropertyOptional({
    description: 'Force nil-payment indicator. Omit to auto-suggest from closed runs.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  noPaymentThisPeriod?: boolean;

  @ApiPropertyOptional({ description: 'Override Employment Allowance claim for this preview' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  employmentAllowanceClaimed?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  smpRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sppRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sapRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shppRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  spbpRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nicCompensationOnStatutory?: number;
}

export enum HmrcFpsSubmitModeDto {
  DRY_RUN = 'DRY_RUN',
  SUBMIT = 'SUBMIT',
}

/** Browser-collected fraud-prevention context (WEB_APP_VIA_SERVER). */
export class HmrcFraudClientContextDto {
  @ApiPropertyOptional({ description: 'Persistent UUID for this browser (localStorage)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;

  @ApiPropertyOptional({ description: 'navigator.userAgent from the browser' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  browserJsUserAgent?: string;

  @ApiPropertyOptional({ example: 'UTC+01:00' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^UTC[+-]\d{2}:\d{2}$/)
  timezone?: string;

  @ApiPropertyOptional({
    example: 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  screens?: string;

  @ApiPropertyOptional({ example: 'width=1256&height=803' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  windowSize?: string;

  @ApiPropertyOptional({
    description: 'Public TCP port of the browser connection when known (1–65535)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  publicPort?: number;
}

/** T16/T17/T18 — build / send FPS GovTalk (LIVE requires dual control). */
export class SubmitHmrcFpsDto {
  @ApiProperty({
    enum: HmrcFpsSubmitModeDto,
    example: HmrcFpsSubmitModeDto.DRY_RUN,
    description:
      'DRY_RUN builds redacted GovTalk XML only. SUBMIT to TEST posts when HMRC_RTI_HTTP_ENABLED=true. SUBMIT to LIVE creates a pending dual-control request (T18).',
  })
  @IsEnum(HmrcFpsSubmitModeDto)
  mode!: HmrcFpsSubmitModeDto;

  @ApiPropertyOptional({
    enum: ['TEST', 'LIVE'],
    default: 'TEST',
    description: 'TEST = Transaction Engine test. LIVE = real HMRC (dual-control on SUBMIT).',
  })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  environment?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({ type: HmrcFraudClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HmrcFraudClientContextDto)
  clientContext?: HmrcFraudClientContextDto;
}

/** T18 — second person approves a pending LIVE FPS send. */
export class ApproveHmrcFpsSubmissionDto {
  @ApiProperty({
    example: 'SEND LIVE FPS',
    description: 'Must be exactly SEND LIVE FPS',
  })
  @IsString()
  @Matches(/^SEND LIVE FPS$/)
  confirmPhrase!: string;

  @ApiPropertyOptional({ type: HmrcFraudClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HmrcFraudClientContextDto)
  clientContext?: HmrcFraudClientContextDto;
}

/** T18 — reject / cancel a pending LIVE FPS send. */
export class RejectHmrcFpsSubmissionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** T19 — build / send EPS GovTalk for a tax month. */
export class SubmitHmrcEpsDto {
  @ApiProperty({ enum: HmrcFpsSubmitModeDto })
  @IsEnum(HmrcFpsSubmitModeDto)
  mode!: HmrcFpsSubmitModeDto;

  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], default: 'TEST' })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  environment?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({ description: 'Payroll tax year id. Defaults to current tax year.' })
  @IsOptional()
  @IsUUID()
  taxYearId?: string;

  @ApiProperty({ example: 1, description: 'UK PAYE tax month 1–12' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth!: number;

  @ApiPropertyOptional({ description: 'Force nil-payment indicator' })
  @IsOptional()
  @IsBoolean()
  noPaymentThisPeriod?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  employmentAllowanceClaimed?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  smpRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sppRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sapRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shppRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  spbpRecovered?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nicCompensationOnStatutory?: number;

  @ApiPropertyOptional({ type: HmrcFraudClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HmrcFraudClientContextDto)
  clientContext?: HmrcFraudClientContextDto;
}

/** T19 — list EPS submissions for a tax month. */
export class ListHmrcEpsSubmissionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taxYearId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth?: number;
}

/** T19 — approve pending LIVE EPS. */
export class ApproveHmrcEpsSubmissionDto {
  @ApiProperty({ example: 'SEND LIVE EPS' })
  @IsString()
  @Matches(/^SEND LIVE EPS$/)
  confirmPhrase!: string;

  @ApiPropertyOptional({ type: HmrcFraudClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HmrcFraudClientContextDto)
  clientContext?: HmrcFraudClientContextDto;
}

/** T19 — reject pending LIVE EPS. */
export class RejectHmrcEpsSubmissionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
