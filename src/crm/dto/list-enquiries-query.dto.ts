import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EnquiryKind, EnquirySource, EnquiryStage } from '@prisma/client';

export class ListEnquiriesQueryDto {
  @ApiPropertyOptional({ enum: EnquiryStage })
  @IsOptional()
  @IsEnum(EnquiryStage)
  stage?: EnquiryStage;

  @ApiPropertyOptional({ enum: EnquiryKind, description: 'Only enquiries or only referrals.' })
  @IsOptional()
  @IsEnum(EnquiryKind)
  kind?: EnquiryKind;

  @ApiPropertyOptional({ enum: EnquirySource })
  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Branch filter (header branch selector).' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Search by reference, name, contact or postcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
