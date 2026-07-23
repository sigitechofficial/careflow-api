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

  @ApiPropertyOptional({ description: '1–7 weekdays for weekly-style; 1–28 for monthly pay day' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
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

export class PurgePayrollDataDto {
  @ApiProperty({
    description: 'Must equal DELETE ALL PAYROLL to confirm irreversible wipe of payroll schema data',
    example: 'DELETE ALL PAYROLL',
  })
  @IsString()
  @Matches(/^DELETE ALL PAYROLL$/)
  confirm!: string;
}
