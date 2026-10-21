import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { EnquirySource, EnquiryStage } from '@prisma/client';

export class ListEnquiriesQueryDto {
  @ApiPropertyOptional({ enum: EnquiryStage })
  @IsOptional()
  @IsEnum(EnquiryStage)
  stage?: EnquiryStage;

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
}
