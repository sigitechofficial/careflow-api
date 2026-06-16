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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  baseLocationId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Multiple base/home sites for this employee' })
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
}

