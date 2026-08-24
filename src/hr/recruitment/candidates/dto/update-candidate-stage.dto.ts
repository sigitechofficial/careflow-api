import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCandidateStageDto {
  @ApiProperty({ enum: CandidateStage })
  @IsEnum(CandidateStage)
  stage!: CandidateStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
