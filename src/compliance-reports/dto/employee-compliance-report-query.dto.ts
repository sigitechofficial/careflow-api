import { ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceCategory, EmployeeComplianceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { TransformStringArrayQuery } from '../../common/transformers/string-array-query.transform';
import { TransformOptionalBooleanQuery } from '../../common/transformers/optional-boolean-query.transform';

/** Shared filters for compliance report endpoints */
export class EmployeeComplianceReportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Filter by employment immigration / visa type ids' })
  @IsOptional()
  @TransformStringArrayQuery()
  @IsArray()
  @IsString({ each: true })
  visaTypeIds?: string[];

  @ApiPropertyOptional({
    description:
      'When true, only staff who need immigration RTW docs (biometric/share code). When false, only those who do not.',
  })
  @IsOptional()
  @TransformOptionalBooleanQuery()
  @IsBoolean()
  needsImmigrationRtw?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive employee name search' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['BLOCKED', 'ATTENTION', 'COMPLIANT'] })
  @IsOptional()
  @IsString()
  displayStatus?: 'BLOCKED' | 'ATTENTION' | 'COMPLIANT';

  @ApiPropertyOptional({
    enum: ['expired', 'expiring_7', 'expiring_8_30', 'missing', 'valid'],
  })
  @IsOptional()
  @IsString()
  documentState?: 'expired' | 'expiring_7' | 'expiring_8_30' | 'missing' | 'valid';

  @ApiPropertyOptional({ description: 'Only employees with Blocked or Attention display status' })
  @IsOptional()
  @TransformOptionalBooleanQuery()
  @IsBoolean()
  issuesOnly?: boolean;

  @ApiPropertyOptional({ enum: ['urgent', 'nearest_expiry', 'name'], default: 'urgent' })
  @IsOptional()
  @IsString()
  boardSort?: 'urgent' | 'nearest_expiry' | 'name';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  complianceTypeId?: string;

  @ApiPropertyOptional({ enum: ComplianceCategory })
  @IsOptional()
  @IsEnum(ComplianceCategory)
  category?: ComplianceCategory;

  @ApiPropertyOptional({ enum: EmployeeComplianceStatus })
  @IsOptional()
  @IsEnum(EmployeeComplianceStatus)
  status?: EmployeeComplianceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  expiryDateFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  expiryDateTo?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hideNoLongerRequired?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactiveEmployees?: boolean = false;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['expiryDate', 'createdAt', 'employeeName'] })
  @IsOptional()
  @IsString()
  sortBy?: 'expiryDate' | 'createdAt' | 'employeeName' = 'expiryDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}
