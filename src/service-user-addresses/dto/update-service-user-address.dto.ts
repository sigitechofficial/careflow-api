import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { HOME_ACCESS_METHOD_VALUES } from '../home-access.constants';

export class UpdateServiceUserAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  town?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  county?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  country?: string;

  @ApiPropertyOptional({
    maxLength: 20,
    description: 'Main postcode (usually from the assigned service-user area)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;

  @ApiPropertyOptional({
    maxLength: 20,
    description: 'Secondary postcode from the searched / home street address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  secondaryPostcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({
    enum: HOME_ACCESS_METHOD_VALUES,
    description: 'How carers enter the property',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsIn([...HOME_ACCESS_METHOD_VALUES])
  accessMethod?: string | null;

  @ApiPropertyOptional({ maxLength: 200, description: 'Where the key safe is fitted (not the code)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keySafeLocation?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Key safe code' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keySafeNumber?: string;
}
