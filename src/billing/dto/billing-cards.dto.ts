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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BANK_HOLIDAY_REGIONS } from '../bank-holiday-regions.util';
import {
  BillingCardStatus,
  BillingChargeMethod,
  BillingDayType,
  BillingFrequency,
  BillingRateType,
  ChargeCardAssignmentLevel,
  PayCardAssignmentLevel,
} from '@prisma/client';

export class PayCardRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceType?: string;

  @ApiPropertyOptional({ enum: BillingDayType })
  @IsOptional()
  @IsEnum(BillingDayType)
  dayType?: BillingDayType;

  @ApiPropertyOptional({ example: '06:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ enum: BillingRateType })
  @IsOptional()
  @IsEnum(BillingRateType)
  rateType?: BillingRateType;

  @ApiProperty({ example: 12.5 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  multiplier?: number;

  @ApiPropertyOptional({ example: 1.0, description: '£/hr added to base (ADDITIONAL_PER_HOUR)' })
  @IsOptional()
  @IsNumber()
  additionalAmount?: number;

  @ApiPropertyOptional({ example: 25, description: 'Percentage uplift e.g. 25 = +25%' })
  @IsOptional()
  @IsNumber()
  percentageUplift?: number;

  @ApiPropertyOptional({
    enum: [
      'ABSOLUTE_HOURLY',
      'ADDITIONAL_PER_HOUR',
      'PERCENTAGE_UPLIFT',
      'MULTIPLIER',
      'FIXED_SHIFT_ALLOWANCE',
    ],
  })
  @IsOptional()
  @IsString()
  enhancementMethod?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roundingRule?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  appliesToVisit?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  appliesToTravel?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  appliesToWaiting?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  appliesToTraining?: boolean;
}

export class ChargeCardRuleDto extends PayCardRuleDto {
  @ApiPropertyOptional({ enum: BillingChargeMethod })
  @IsOptional()
  @IsEnum(BillingChargeMethod)
  chargeMethod?: BillingChargeMethod;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  chargeableFlag?: boolean;
}

export class CreatePayCardDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  code!: string;

  @ApiPropertyOptional({ enum: PayCardAssignmentLevel })
  @IsOptional()
  @IsEnum(PayCardAssignmentLevel)
  assignmentLevel?: PayCardAssignmentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignmentLabel?: string;

  @ApiPropertyOptional({ description: 'Role, branch, or contract type id' })
  @IsOptional()
  @IsString()
  assignmentTargetId?: string | null;

  @ApiPropertyOptional({ description: 'Worker type key: AGENCY, BANK, INTERNAL' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  assignmentTargetKey?: string | null;

  @ApiPropertyOptional({ default: 'GBP' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: ['PRIORITY', 'HIGHEST', 'STACK'], default: 'PRIORITY' })
  @IsOptional()
  @IsIn(['PRIORITY', 'HIGHEST', 'STACK'])
  stackingPolicy?: string;

  @ApiPropertyOptional({
    enum: BANK_HOLIDAY_REGIONS,
    description: 'Bank holiday calendar for pay: UK = England & Wales (default), SCOTLAND, NORTHERN_IRELAND',
  })
  @IsOptional()
  @IsIn([...BANK_HOLIDAY_REGIONS, null])
  bankHolidayRegion?: string | null;

  @ApiPropertyOptional({ description: 'UK nation code e.g. ENG, SCT, WLS, NIR' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  nation?: string;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  payFrequency?: BillingFrequency;

  @ApiPropertyOptional({
    enum: ['ACCRUAL_WHEN_TAKEN', 'ROLLED_UP_12_07', 'REFERENCE_52_WEEK', 'CONTRACTUAL_ABOVE_STATUTORY'],
  })
  @IsOptional()
  @IsString()
  holidayPayMethod?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  travelInheritsTimeBands?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  useUkMileageRates?: boolean;

  @ApiPropertyOptional({
    enum: ['CAR_VAN', 'MOTORCYCLE', 'BICYCLE', 'COMPANY_VEHICLE', 'PUBLIC_TRANSPORT'],
  })
  @IsOptional()
  @IsString()
  mileageVehicleType?: string;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [PayCardRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayCardRuleDto)
  rules?: PayCardRuleDto[];
}

export class UpdatePayCardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiPropertyOptional({ enum: PayCardAssignmentLevel })
  @IsOptional()
  @IsEnum(PayCardAssignmentLevel)
  assignmentLevel?: PayCardAssignmentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignmentLabel?: string;

  @ApiPropertyOptional({ description: 'Role, branch, or contract type id' })
  @IsOptional()
  @IsString()
  assignmentTargetId?: string | null;

  @ApiPropertyOptional({ description: 'Worker type key: AGENCY, BANK, INTERNAL' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  assignmentTargetKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: ['PRIORITY', 'HIGHEST', 'STACK'] })
  @IsOptional()
  @IsIn(['PRIORITY', 'HIGHEST', 'STACK'])
  stackingPolicy?: string;

  @ApiPropertyOptional({
    enum: BANK_HOLIDAY_REGIONS,
    description: 'Bank holiday calendar for pay: UK = England & Wales (default), SCOTLAND, NORTHERN_IRELAND',
  })
  @IsOptional()
  @IsIn([...BANK_HOLIDAY_REGIONS, null])
  bankHolidayRegion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  nation?: string;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  payFrequency?: BillingFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  holidayPayMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  travelInheritsTimeBands?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useUkMileageRates?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mileageVehicleType?: string;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [PayCardRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayCardRuleDto)
  rules?: PayCardRuleDto[];

  @ApiPropertyOptional({
    description:
      'When rates change on a non-draft card: date (YYYY-MM-DD) the new version applies from. Defaults to today.',
  })
  @IsOptional()
  @IsDateString()
  versionEffectiveFrom?: string;

  @ApiPropertyOptional({ description: 'Reason for the rate change (stored on the new version).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  versionNote?: string;
}

/** PC-32: the card as it is in the form (saved or not), checked against the other active cards. */
export class PayCardConflictCheckDto {
  @ApiPropertyOptional({ description: 'The card being edited; left out for a new card' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ enum: PayCardAssignmentLevel })
  @IsOptional()
  @IsEnum(PayCardAssignmentLevel)
  assignmentLevel?: PayCardAssignmentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignmentTargetId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  assignmentTargetKey?: string | null;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;
}

/** Sample visit for the pay preview — calculates only, nothing is saved. */
export class PreviewPayDto {
  @ApiProperty({ type: [PayCardRuleDto], description: 'Rules as currently shown in the pay card form' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayCardRuleDto)
  rules!: PayCardRuleDto[];

  @ApiPropertyOptional({ enum: ['PRIORITY', 'HIGHEST', 'STACK'] })
  @IsOptional()
  @IsIn(['PRIORITY', 'HIGHEST', 'STACK'])
  stackingPolicy?: string;

  @ApiPropertyOptional({ enum: BANK_HOLIDAY_REGIONS })
  @IsOptional()
  @IsIn([...BANK_HOLIDAY_REGIONS, null])
  bankHolidayRegion?: string | null;

  @ApiProperty({ description: 'Visit date YYYY-MM-DD (organisation timezone)' })
  @IsDateString()
  date!: string;

  @ApiProperty({ description: 'Start HH:mm' })
  @IsString()
  @MaxLength(5)
  startTime!: string;

  @ApiProperty({ description: 'End HH:mm (earlier than start = next day)' })
  @IsString()
  @MaxLength(5)
  endTime!: string;

  @ApiPropertyOptional({ enum: ['SLEEPING_NIGHT', 'WAKING_NIGHT'] })
  @IsOptional()
  @IsIn(['SLEEPING_NIGHT', 'WAKING_NIGHT', null])
  nightDuty?: string | null;
}

export class PersonalPayCardDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Defaults to IND-<employee number>' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiProperty({ type: [PayCardRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayCardRuleDto)
  rules!: PayCardRuleDto[];
}

/** Change a carer's own pay card from a date (e.g. promotion), keeping the old card for earlier visits. */
export class ChangeEmployeePayCardDto {
  @ApiPropertyOptional({ description: 'Existing pay card to move the carer to' })
  @IsOptional()
  @IsUUID()
  payCardId?: string;

  @ApiPropertyOptional({ type: PersonalPayCardDto, description: 'Create a pay card for this carer only' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalPayCardDto)
  personalCard?: PersonalPayCardDto;

  @ApiProperty({ description: 'YYYY-MM-DD the new card applies from' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({
    description: 'New grade for the carer (updated straight away — grades have no effective date)',
  })
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreateChargeCardDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  code!: string;

  @ApiPropertyOptional({ enum: ChargeCardAssignmentLevel })
  @IsOptional()
  @IsEnum(ChargeCardAssignmentLevel)
  assignmentLevel?: ChargeCardAssignmentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignmentLabel?: string;

  @ApiPropertyOptional({ description: 'Funder, service user, branch, or funding contract id' })
  @IsOptional()
  @IsString()
  assignmentTargetId?: string | null;

  @ApiPropertyOptional({ description: 'Package name, service type, or household key' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignmentTargetKey?: string | null;

  @ApiPropertyOptional({ default: 'GBP' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxTreatment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceGroupingRule?: string;

  @ApiPropertyOptional({ enum: BillingChargeMethod })
  @IsOptional()
  @IsEnum(BillingChargeMethod)
  defaultChargeMethod?: BillingChargeMethod;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [ChargeCardRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeCardRuleDto)
  rules?: ChargeCardRuleDto[];
}

export class UpdateChargeCardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @ApiPropertyOptional({ enum: ChargeCardAssignmentLevel })
  @IsOptional()
  @IsEnum(ChargeCardAssignmentLevel)
  assignmentLevel?: ChargeCardAssignmentLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignmentLabel?: string;

  @ApiPropertyOptional({ description: 'Funder, service user, branch, or funding contract id' })
  @IsOptional()
  @IsString()
  assignmentTargetId?: string | null;

  @ApiPropertyOptional({ description: 'Package name, service type, or household key' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignmentTargetKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingFrequency })
  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxTreatment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceGroupingRule?: string;

  @ApiPropertyOptional({ enum: BillingChargeMethod })
  @IsOptional()
  @IsEnum(BillingChargeMethod)
  defaultChargeMethod?: BillingChargeMethod;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [ChargeCardRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeCardRuleDto)
  rules?: ChargeCardRuleDto[];
}

export class BillingCardQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: BillingCardStatus })
  @IsOptional()
  @IsEnum(BillingCardStatus)
  status?: BillingCardStatus;

  @ApiPropertyOptional({
    description:
      'When set, hide BRANCH / BRANCH_REGION cards targeted at other locations',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class AssignPayCardMatchingDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Only assign carers without an explicit default pay card',
  })
  @IsOptional()
  @IsBoolean()
  onlyUnassigned?: boolean;
}

export class UnassignPayCardEmployeeDto {
  @ApiProperty({ description: 'Employee to remove from this pay card' })
  @IsString()
  employeeId!: string;
}

export class UpsertEmployeeFunderPayAssignmentDto {
  @ApiProperty({ description: 'Carer / employee id' })
  @IsString()
  employeeId!: string;

  @ApiProperty({ description: 'Council / funder id' })
  @IsString()
  funderId!: string;

  @ApiProperty({ description: 'Pay card to use for visits funded by this funder' })
  @IsString()
  payCardId!: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD; defaults to today (UTC)' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD inclusive end; omit for open-ended' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateEmployeeFunderPayAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payCardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class AssignChargeCardMatchingDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Only assign records without an explicit default charge card',
  })
  @IsOptional()
  @IsBoolean()
  onlyUnassigned?: boolean;
}
