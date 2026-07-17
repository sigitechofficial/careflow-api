import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const EMPLOYEE_COMPLIANCE_STATUSES = ['compliant', 'action_required', 'breach'] as const;
export type EmployeeComplianceStatus = (typeof EMPLOYEE_COMPLIANCE_STATUSES)[number];

export const EMPLOYEE_REVIEW_FILTERS = ['all', 'completed', 'pending'] as const;
export type EmployeeReviewFilter = (typeof EMPLOYEE_REVIEW_FILTERS)[number];

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class EmployeeHoursMonthlyQueryDto {
  @ApiPropertyOptional({
    example: '2026-07',
    description: 'Calendar month (YYYY-MM). Defaults to the current month.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_COMPLIANCE_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYEE_COMPLIANCE_STATUSES)
  complianceStatus?: EmployeeComplianceStatus;

  @ApiPropertyOptional({ enum: EMPLOYEE_REVIEW_FILTERS, description: 'Monthly review state' })
  @IsOptional()
  @IsIn(EMPLOYEE_REVIEW_FILTERS)
  reviewFilter?: EmployeeReviewFilter;

  @ApiPropertyOptional({ description: 'Only rows where SMS reporting is required' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  smsOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only sponsored workers (Skilled / Health and Care visas)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  sponsoredOnly?: boolean;

  @ApiPropertyOptional({ description: 'Filter by employee branch/location id' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'When true, include inactive employees' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

export class UpsertEmployeeHoursMonthlyReviewDto {
  @ApiProperty({ description: 'Employee id' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: '2026-07', description: 'Calendar month (YYYY-MM)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @ApiPropertyOptional({ description: 'Monthly review completed' })
  @IsOptional()
  @IsBoolean()
  reviewCompleted?: boolean;

  @ApiPropertyOptional({
    description: 'Manual SMS reporting override; null resets to the derived value',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  smsReportingRequired?: boolean | null;

  @ApiPropertyOptional({
    enum: EMPLOYEE_COMPLIANCE_STATUSES,
    description: 'Manual compliance status override; null resets to the derived value',
    nullable: true,
  })
  @IsOptional()
  @IsIn([...EMPLOYEE_COMPLIANCE_STATUSES])
  complianceStatusOverride?: EmployeeComplianceStatus | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comments?: string | null;
}
