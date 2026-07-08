import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateEmployeeEmploymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workAreaId?: string;

  @ApiPropertyOptional({ description: 'Employee role/designation' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rbacLevelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  leavingReasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leavingNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nationalInsuranceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nmcPinNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  travelPaymentTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payrollNumber?: string;

  @ApiPropertyOptional({ description: 'Default pay card for this carer' })
  @IsOptional()
  @IsUUID()
  defaultPayCardId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  baseLocationId?: string;

  @ApiPropertyOptional({ description: 'Multiple base/home sites for this employee' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  baseLocationIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  accessAllZones?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  defaultZoneView?: boolean;

  @ApiPropertyOptional({ description: 'Visa type id from organisation employee visa settings' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  visaTypeId?: string | null;

  @ApiPropertyOptional({ description: 'Whether the employee is currently in the country' })
  @IsOptional()
  @IsBoolean()
  isInCountry?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  contractedWeeklyHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maximumWeeklyHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumWeeklyHours?: number;

  @ApiPropertyOptional({
    description:
      'Per-employee approved weekly hours cap above immigration status default. Requires weeklyHoursCapOverrideReason.',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(168)
  weeklyHoursCapOverride?: number | null;

  @ApiPropertyOptional({
    description: 'Documented reason for weekly hours cap override',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  weeklyHoursCapOverrideReason?: string | null;

  @ApiPropertyOptional({
    description: 'When the hours cap override expires (optional)',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  weeklyHoursCapOverrideExpiresAt?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optedOutOf48Hours?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAgencyStaff?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agencyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agencyRating?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPreferredAgency?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isBlacklisted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyDayRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyNightRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isBankStaff?: boolean;

  @ApiPropertyOptional({ enum: [1, 2], description: '1 = standard week; 2 = fortnight working pattern' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2)
  workingPatternCycleWeeks?: number;

  @ApiPropertyOptional({ description: 'ISO date — which calendar week is Week 1 of the cycle' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  workingPatternCycleAnchorDate?: Date | null;
}

