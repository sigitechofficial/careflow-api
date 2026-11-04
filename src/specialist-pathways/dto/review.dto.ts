import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SpecialistPathwayReviewOutcome } from '@prisma/client';

export class CreatePathwayReviewDto {
  @ApiProperty({ format: 'date', description: 'When the review took place.' })
  @IsString()
  reviewedAt!: string;

  @ApiProperty({ enum: SpecialistPathwayReviewOutcome })
  @IsEnum(SpecialistPathwayReviewOutcome)
  outcome!: SpecialistPathwayReviewOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Becomes the case review due date.' })
  @IsOptional()
  @IsString()
  nextReviewDate?: string;
}

export class ClosePathwayCaseDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
