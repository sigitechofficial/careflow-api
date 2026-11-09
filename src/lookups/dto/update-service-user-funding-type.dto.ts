import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateServiceUserFundingTypeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Funding route only: the broad billing type it comes under (null to clear).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  billingFundingTypeId?: string | null;
}
