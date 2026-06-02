import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { MedicationStatusCodeCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class MedicationStatusCodeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: MedicationStatusCodeCategory })
  @IsOptional()
  @IsEnum(MedicationStatusCodeCategory)
  category?: MedicationStatusCodeCategory;

  @ApiPropertyOptional({ default: 'sortOrder' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
