import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class EmployeeAppSosDto {
  @ApiPropertyOptional({ example: 51.5074 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: -0.1278 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockedLocation?: boolean;

  @ApiPropertyOptional({
    description: 'True when the device could not capture GPS. SOS is still accepted.',
  })
  @IsOptional()
  @IsBoolean()
  locationUnavailable?: boolean;

  @ApiPropertyOptional({ description: 'Optional note from the carer' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceRecordedAt?: string;

  @ApiPropertyOptional({
    description: 'Same key within 30s returns the existing alert (double-tap guard).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}
