import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class EmployeeAppAreaPresenceDto {
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

  @ApiPropertyOptional({
    description: 'App/sim asserts the carer is outside the visit geofence',
  })
  @IsOptional()
  @IsBoolean()
  outsideArea?: boolean;
}
