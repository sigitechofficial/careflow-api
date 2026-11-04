import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CarerTimebankQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-02',
    description:
      'Any date in the Monday–Sunday week (org timezone). Defaults to the current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  @ApiPropertyOptional({ description: 'Filter by branch/location id' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Carer name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CarerTimebankDetailQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-02',
    description:
      'Any date in the Monday–Sunday week. Defaults to the current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;
}
