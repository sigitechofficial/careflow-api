import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SHARE_TARGETS = ['handover', 'manager', 'family'] as const;

export class CreateCommunicationNoteDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  position!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiProperty({ maxLength: 20_000 })
  @IsString()
  @MaxLength(20_000)
  outcome!: string;

  @ApiPropertyOptional({ description: 'Signature image data URL.' })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  signature?: string;

  @ApiProperty({ example: '2026-09-25T13:00:00.000Z' })
  @IsISO8601()
  recordedAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['handover', 'manager'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SHARE_TARGETS, { each: true })
  shareWith?: string[];
}
