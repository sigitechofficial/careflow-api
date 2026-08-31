import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HrDocumentStatus, HrDocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateHrDocumentDto {
  @ApiProperty({ enum: HrDocumentType })
  @IsEnum(HrDocumentType)
  documentType!: HrDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @ApiPropertyOptional({ enum: HrDocumentStatus, default: HrDocumentStatus.PENDING })
  @IsOptional()
  @IsEnum(HrDocumentStatus)
  status?: HrDocumentStatus;
}
