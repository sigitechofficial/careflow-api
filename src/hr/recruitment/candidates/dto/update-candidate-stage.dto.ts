import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateStage } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCandidateStageDto {
  @ApiProperty({ enum: CandidateStage })
  @IsEnum(CandidateStage)
  stage!: CandidateStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'When rejecting: email the candidate that they were not successful. Default: false.' })
  @IsOptional()
  @IsBoolean()
  notifyCandidate?: boolean;
}
