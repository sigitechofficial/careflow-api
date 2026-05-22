import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class DefaultFormSelectionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['name', 'lastPublishedAt', 'createdAt'], default: 'name' })
  @IsOptional()
  @IsIn(['name', 'lastPublishedAt', 'createdAt'])
  sortBy?: 'name' | 'lastPublishedAt' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
