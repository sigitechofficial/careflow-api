import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SortQueryDto } from '../../common/dto/sort-query.dto';
import { TransformStringArrayQuery } from '../../common/transformers/string-array-query.transform';
import { TransformUuidArrayQuery } from '../../common/transformers/uuid-array-query.transform';
import { EMPLOYEE_LIST_SORT_FIELDS } from '../employee-list-order.util';
import {
  EMPLOYEE_BRANCH_SCOPE_KINDS,
  EMPLOYEE_COMPLIANCE_FILTER_VALUES,
  type EmployeeBranchScopeKind,
  type EmployeeComplianceFilter,
} from '../employee-list-advanced-filter.util';

export class EmployeeQueryDto extends PaginationQueryDto implements SortQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, email, username' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Employee status lookup ids' })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  statusIds?: string[];

  @ApiPropertyOptional({ description: 'Legacy single role filter' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Role lookup ids' })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ description: 'Legacy single job title filter' })
  @IsOptional()
  @IsUUID()
  jobTitleId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  jobTitleIds?: string[];

  @ApiPropertyOptional({ description: 'Legacy single grade filter' })
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  gradeIds?: string[];

  @ApiPropertyOptional({ description: 'Legacy single contract type filter' })
  @IsOptional()
  @IsUUID()
  contractTypeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  contractTypeIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Branch / location ids (primary or floor location; includes access-all-zones carers)',
  })
  @IsOptional()
  @TransformUuidArrayQuery()
  @IsArray()
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Immigration catalog ids (e.g. skilled_worker)' })
  @IsOptional()
  @TransformStringArrayQuery()
  @IsArray()
  @IsString({ each: true })
  visaTypeIds?: string[];

  @ApiPropertyOptional({ description: 'Filter by whether the employee is currently in country' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isInCountry?: boolean;

  @ApiPropertyOptional({
    type: [String],
    enum: EMPLOYEE_BRANCH_SCOPE_KINDS,
    description: 'Branch scope kinds (all-zones, single, multiple, none)',
  })
  @IsOptional()
  @TransformStringArrayQuery()
  @IsArray()
  @IsIn(EMPLOYEE_BRANCH_SCOPE_KINDS, { each: true })
  branchScopeKinds?: EmployeeBranchScopeKind[];

  @ApiPropertyOptional({
    enum: EMPLOYEE_COMPLIANCE_FILTER_VALUES,
    description: 'Compliance attention filter (30-day horizon)',
  })
  @IsOptional()
  @IsIn(EMPLOYEE_COMPLIANCE_FILTER_VALUES)
  complianceFilter?: EmployeeComplianceFilter;

  @ApiPropertyOptional({ example: 'name', enum: EMPLOYEE_LIST_SORT_FIELDS })
  @IsOptional()
  @IsIn(EMPLOYEE_LIST_SORT_FIELDS)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
