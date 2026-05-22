import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PathwayChecklistSortBy } from '../enums/pathway-checklist-query.enum';

export class PathwayChecklistQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  observationEnabled?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  recordPhoto?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  familyShare?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  groupAction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  carePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  analysisGroupId?: string;

  @ApiPropertyOptional({ enum: PathwayChecklistSortBy })
  @IsOptional()
  @IsEnum(PathwayChecklistSortBy)
  sortBy?: PathwayChecklistSortBy;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
