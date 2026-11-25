import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  INITIAL_ASSESSMENT_LIST_SORTS,
  INITIAL_ASSESSMENT_LIST_VIEWS,
  type InitialAssessmentListSort,
  type InitialAssessmentListView,
} from '../initial-assessment-list.util';

export class InitialAssessmentListQueryDto {
  @ApiPropertyOptional({ description: 'Name, preferred name or service user number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Branch (Location) id; must be inside the caller\'s branches', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ enum: INITIAL_ASSESSMENT_LIST_VIEWS, default: 'all' })
  @IsOptional()
  @IsIn(INITIAL_ASSESSMENT_LIST_VIEWS as unknown as string[])
  view?: InitialAssessmentListView;

  @ApiPropertyOptional({ enum: INITIAL_ASSESSMENT_LIST_SORTS, default: 'updated' })
  @IsOptional()
  @IsIn(INITIAL_ASSESSMENT_LIST_SORTS as unknown as string[])
  sort?: InitialAssessmentListSort;

  @ApiPropertyOptional({ description: 'Role name held by the office user who started the IA (e.g. Manager)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  startedByRole?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
