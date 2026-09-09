import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class EmployeeAppCheckInMethodRequestDto {
  @ApiPropertyOptional({ description: 'Optional free-text note for the office' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

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
    description: 'True when the device could not capture GPS. Request is still accepted.',
  })
  @IsOptional()
  @IsBoolean()
  locationUnavailable?: boolean;
}
