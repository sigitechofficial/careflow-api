import { ApiProperty } from '@nestjs/swagger';
import { HrDocumentStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateHrDocumentStatusDto {
  @ApiProperty({ enum: HrDocumentStatus })
  @IsEnum(HrDocumentStatus)
  status!: HrDocumentStatus;
}
