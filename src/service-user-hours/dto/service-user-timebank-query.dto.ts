import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class ServiceUserTimebankQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-02',
    description: 'Any date in the Monday–Sunday week (org timezone). Defaults to the current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;

  @ApiPropertyOptional({ description: 'Filter by branch/location id' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by funding type id' })
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional({ description: 'Name or service user number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ServiceUserTimebankDetailQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-02',
    description: 'Any date in the Monday–Sunday week shown in the cards. Defaults to the current week.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart?: string;
}
