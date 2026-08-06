import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
}
