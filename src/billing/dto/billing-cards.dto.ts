import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
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

export class AssignChargeCardMatchingDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Only assign records without an explicit default charge card',
  })
  @IsOptional()
  @IsBoolean()
  onlyUnassigned?: boolean;
}
