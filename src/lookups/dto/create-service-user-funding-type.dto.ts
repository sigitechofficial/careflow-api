import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateServiceUserFundingTypeDto {
  @ApiProperty({ example: 'Local Authority' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'LOCAL_AUTHORITY' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ description: 'Funding route only: the broad billing type it comes under (null to clear).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  billingFundingTypeId?: string | null;
}
