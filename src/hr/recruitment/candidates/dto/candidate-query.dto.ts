import { ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateStage } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Only rejected and withdrawn candidates, most recently closed first, with the step each was closed at.',
  })
  @IsOptional()
  // Read the raw value: implicit conversion would turn the string "false" into true.
  @Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true')
  @IsBoolean()
  closed?: boolean;
}
