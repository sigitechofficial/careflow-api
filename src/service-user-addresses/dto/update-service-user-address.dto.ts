import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keySafeNumber?: string;
}
