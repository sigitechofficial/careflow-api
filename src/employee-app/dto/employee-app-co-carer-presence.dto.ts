import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class EmployeeAppCoCarerPresenceDto {
  @ApiProperty({
    description: 'true = partner marked arrived / on site; false = marked left',
  })
  @IsBoolean()
  present!: boolean;

  @ApiProperty({ description: 'Device ISO-8601 timestamp for the presence change' })
  @IsISO8601()
  at!: string;

  @ApiProperty({ description: 'Offline-safe replay key' })
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
