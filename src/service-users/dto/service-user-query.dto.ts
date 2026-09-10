import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CARE_PLAN_LIST_STATUS_FILTERS, INITIAL_ASSESSMENT_STATUS_FILTERS } from '../service-user-list-filters.util';

const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'firstName',
  'lastName',
  'serviceStartDate',
  'serviceUserNumber',
  'dateOfBirth',
] as const;

function queryBool({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class ServiceUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  careTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  riskLevelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  keyWorkerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  namedNurseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirthFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirthTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  serviceStartDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  serviceStartDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showInactive?: boolean;

  @ApiPropertyOptional({ description: 'When true, list only soft-deleted service users' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showDeleted?: boolean;

  @ApiPropertyOptional({ enum: SORT_FIELDS })
  @IsOptional()
  @IsIn([...SORT_FIELDS])
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Inclusive minimum age (years); converted to DOB upper bound' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  ageMin?: number;

  @ApiPropertyOptional({ description: 'Inclusive maximum age (years); converted to DOB lower bound' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  ageMax?: number;

  @ApiPropertyOptional({ description: 'Only service users with an active flash message' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  hasActiveFlashMessage?: boolean;

  @ApiPropertyOptional({
    description: 'Only service users with an active HOSPITALISED absence',
  })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  hospitalisedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only service users with no key worker assigned' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  unassignedKeyWorker?: boolean;

  @ApiPropertyOptional({
    enum: CARE_PLAN_LIST_STATUS_FILTERS,
    description: 'Filter by published care-plan review status (matches list icons)',
  })
  @IsOptional()
  @IsIn([...CARE_PLAN_LIST_STATUS_FILTERS])
  carePlanListStatus?: (typeof CARE_PLAN_LIST_STATUS_FILTERS)[number];

  @ApiPropertyOptional({ description: 'Active medical condition catalogue id' })
  @IsOptional()
  @IsUUID()
  medicalConditionId?: string;

  @ApiPropertyOptional({
    enum: INITIAL_ASSESSMENT_STATUS_FILTERS,
    description: 'Initial Assessment bucket: none / in_progress / awaiting_review / completed',
  })
  @IsOptional()
  @IsIn([...INITIAL_ASSESSMENT_STATUS_FILTERS])
  initialAssessmentStatus?: (typeof INITIAL_ASSESSMENT_STATUS_FILTERS)[number];

  @ApiPropertyOptional({
    description: 'Minimum confirmed ECM missed visits (requires aggregation)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  missedVisitsMin?: number;

  @ApiPropertyOptional({ description: 'Missed-visits window start (localVisitDate)' })
  @IsOptional()
  @IsDateString()
  missedVisitsFrom?: string;

  @ApiPropertyOptional({ description: 'Missed-visits window end (localVisitDate)' })
  @IsOptional()
  @IsDateString()
  missedVisitsTo?: string;

  @ApiPropertyOptional({ description: 'Open lone-worker IA risk record' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  loneWorkerRisk?: boolean;

  @ApiPropertyOptional({ description: 'Has verbal aggression incident (primary SU)' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  verbalAltercation?: boolean;

  @ApiPropertyOptional({ description: 'Has physical aggression incident (primary SU)' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  physicalAltercation?: boolean;

  @ApiPropertyOptional({ description: 'Date of death from (inclusive)' })
  @IsOptional()
  @IsDateString()
  dateOfDeathFrom?: string;

  @ApiPropertyOptional({ description: 'Date of death to (inclusive)' })
  @IsOptional()
  @IsDateString()
  dateOfDeathTo?: string;

  @ApiPropertyOptional({
    description: 'Safeguarding PHYSICAL_ABUSE incident (SU as primary / affected)',
  })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  physicalAbuseToSu?: boolean;

  @ApiPropertyOptional({ description: 'Domestic abuse / violence safeguarding incident' })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  domesticViolence?: boolean;

  @ApiPropertyOptional({
    description: 'Any safeguarding-category incident (abuse history overview)',
  })
  @IsOptional()
  @Transform(queryBool)
  @IsBoolean()
  safeguardingHistory?: boolean;
}
