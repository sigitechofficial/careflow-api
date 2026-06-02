import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InitialAssessmentAttachmentCategory } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadInitialAssessmentAttachmentDto {
  @ApiProperty({ enum: InitialAssessmentAttachmentCategory })
  @IsEnum(InitialAssessmentAttachmentCategory)
  category!: InitialAssessmentAttachmentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: 'Spec section number (1–14)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sectionNumber?: number;
}
