import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateDocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateCandidateDocumentDto {
  @ApiProperty({ enum: CandidateDocumentType })
  @IsEnum(CandidateDocumentType)
  documentType!: CandidateDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;
}
