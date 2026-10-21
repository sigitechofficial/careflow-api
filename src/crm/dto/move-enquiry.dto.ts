import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EnquiryLostReason, EnquiryStage } from '@prisma/client';

export class MoveEnquiryDto {
  @ApiProperty({ enum: EnquiryStage })
  @IsEnum(EnquiryStage)
  stage!: EnquiryStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ enum: EnquiryLostReason, description: 'Required when moving to LOST.' })
  @IsOptional()
  @IsEnum(EnquiryLostReason)
  lostReasonCode?: EnquiryLostReason;

  @ApiPropertyOptional({ description: 'Extra detail for the lost reason (required when the reason is OTHER).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lostReason?: string;
}
