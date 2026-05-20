import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME_DISPLAY_FORMATS = ['HH_XX', 'HH_MM'] as const;
const DEFAULT_CARER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const HOLIDAY_UNITS = ['HOURS', 'DAYS'] as const;
const COMPLIANCE_REQUIRED_BY = ['ROLE_WORK_AREA', 'CITIZENSHIP'] as const;
const COMPLIANCE_APPROVAL_TYPES = ['MANAGER_APPROVAL', 'HR_APPROVAL'] as const;
const WELLBEING_REGULARITIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const ACTIONS_DEFAULT_VIEWS = ['TASK_LIST', 'ACTIONS_LIST'] as const;
const ALLOCATE_EMPLOYEE_BY = ['FLOOR', 'WARD', 'UNIT', 'TEAM', 'ZONE'] as const;

export class UpdateOrganisationGeneralSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  reviewCarePlanAfterDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  handoverReportLastHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  archiveServiceUserAfterMonths?: number;

  @ApiPropertyOptional({ enum: TIME_DISPLAY_FORMATS })
  @IsOptional()
  @IsIn(TIME_DISPLAY_FORMATS)
  timeDisplayFormat?: (typeof TIME_DISPLAY_FORMATS)[number];

  @ApiPropertyOptional({ enum: DEFAULT_CARER_STATUSES })
  @IsOptional()
  @IsIn(DEFAULT_CARER_STATUSES)
  defaultCarerStatus?: (typeof DEFAULT_CARER_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendEmailWhenEmployeeActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowMultipleRoles?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowWeekendDaysInHoliday?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mandateComplianceForNewEmployees?: boolean;

  @ApiPropertyOptional({ enum: HOLIDAY_UNITS })
  @IsOptional()
  @IsIn(HOLIDAY_UNITS)
  defaultHolidaysUnit?: (typeof HOLIDAY_UNITS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recruitmentFunctionalityRequired?: boolean;

  @ApiPropertyOptional({ enum: COMPLIANCE_REQUIRED_BY })
  @IsOptional()
  @IsIn(COMPLIANCE_REQUIRED_BY)
  complianceRequiredBy?: (typeof COMPLIANCE_REQUIRED_BY)[number];

  @ApiPropertyOptional({ enum: COMPLIANCE_APPROVAL_TYPES })
  @IsOptional()
  @IsIn(COMPLIANCE_APPROVAL_TYPES)
  complianceApprovalForNewEmployee?: (typeof COMPLIANCE_APPROVAL_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  calculateSicknessBradfordScale?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordServiceUserWellbeing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordEmployeeWellbeing?: boolean;

  @ApiPropertyOptional({ enum: WELLBEING_REGULARITIES })
  @IsOptional()
  @IsIn(WELLBEING_REGULARITIES)
  wellbeingRegularity?: (typeof WELLBEING_REGULARITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel3?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel5?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enhancedRegularActionChecks?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showRegularActionsInDailyList?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowFastAction?: boolean;

  @ApiPropertyOptional({ enum: ACTIONS_DEFAULT_VIEWS })
  @IsOptional()
  @IsIn(ACTIONS_DEFAULT_VIEWS)
  actionsDefaultView?: (typeof ACTIONS_DEFAULT_VIEWS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appDefaultToObservationsTab?: boolean;

  @ApiPropertyOptional({ enum: ALLOCATE_EMPLOYEE_BY })
  @IsOptional()
  @IsIn(ALLOCATE_EMPLOYEE_BY)
  allocateEmployeeBy?: (typeof ALLOCATE_EMPLOYEE_BY)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  restrictCarerToAllocatedServiceUsers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  restrictLoginToShiftTimes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preventCarerWebLogin?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  shiftAccessMinutesBefore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  shiftAccessMinutesAfter?: number;
}
