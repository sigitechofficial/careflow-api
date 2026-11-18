import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateDocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Attach the file as evidence for this pre-employment check.' })
  @IsOptional()
  @IsUUID()
  checkId?: string;
}
