import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { NFC_TAG_STATUSES } from '../nfc-tag-uid.util';

export class UpdateServiceUserNfcTagDto {
  @ApiPropertyOptional({ example: 'Kitchen' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationNote?: string | null;

  @ApiPropertyOptional({ enum: NFC_TAG_STATUSES })
  @IsOptional()
  @IsIn(NFC_TAG_STATUSES)
  status?: (typeof NFC_TAG_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Why the status changed (e.g. sticker peeled off)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  statusReason?: string;
}
