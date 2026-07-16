import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class EmployeeAppVisitCheckInDto {
  @ApiPropertyOptional({ description: 'Client event id for offline idempotency' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientEventId?: string;

  @ApiPropertyOptional({ example: '2026-07-16T07:40:00.000Z' })
  @IsOptional()
  @IsISO8601()
  deviceCapturedAt?: string;

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

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMockLocation?: boolean;

  @ApiPropertyOptional({ description: 'Carer confirmed client identity at check-in' })
  @IsOptional()
  @IsBoolean()
  identityConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  outsideGeofenceReason?: string;
}
