import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class EmailInvoiceToServiceUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceUserId!: string;

  @ApiPropertyOptional({
    description:
      'When set, email only this funder’s share. Pass a funder UUID, or "direct" for Direct/family lines.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  funderId?: string;

  @ApiPropertyOptional({
    description: 'Override recipient. Defaults to funding billing contact, then service user email.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  toEmail?: string;

  @ApiPropertyOptional({
    description: 'Also mark the invoice run as sent after a successful email.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  markSent?: boolean;
}
