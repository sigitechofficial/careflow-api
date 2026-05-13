import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'firstName',
  'lastName',
  'serviceStartDate',
  'serviceUserNumber',
  'dateOfBirth',
] as const;

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

  @ApiPropertyOptional({ enum: SORT_FIELDS })
  @IsOptional()
  @IsIn([...SORT_FIELDS])
  sortBy?: (typeof SORT_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
