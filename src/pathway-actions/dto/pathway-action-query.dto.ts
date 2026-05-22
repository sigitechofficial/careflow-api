import { ApiPropertyOptional } from '@nestjs/swagger';
import { PathwayActionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class PathwayActionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: PathwayActionType })
  @IsOptional()
  @IsEnum(PathwayActionType)
  actionType?: PathwayActionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  checklistId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observationTypeId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  notesMandatory?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  photoAllowed?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  allowFamilyShare?: boolean;
}
