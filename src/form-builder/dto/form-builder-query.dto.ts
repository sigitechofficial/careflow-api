import { ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormStatus, CarePathwayFormType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FormBuilderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: CarePathwayFormType })
  @IsOptional()
  @IsEnum(CarePathwayFormType)
  formType?: CarePathwayFormType;

  @ApiPropertyOptional({ enum: CarePathwayFormStatus })
  @IsOptional()
  @IsEnum(CarePathwayFormStatus)
  status?: CarePathwayFormStatus;

  @ApiPropertyOptional({ enum: ['name', 'updatedAt', 'createdAt', 'formType', 'status'] })
  @IsOptional()
  @IsIn(['name', 'updatedAt', 'createdAt', 'formType', 'status'])
  sortBy?: 'name' | 'updatedAt' | 'createdAt' | 'formType' | 'status';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
