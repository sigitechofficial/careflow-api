import { ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceCategory, EmployeeComplianceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
