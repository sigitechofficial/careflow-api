import { ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';

export class CandidateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vacancyId?: string;

  @ApiPropertyOptional({ enum: CandidateStage })
  @IsOptional()
  @IsEnum(CandidateStage)
  stage?: CandidateStage;
}
