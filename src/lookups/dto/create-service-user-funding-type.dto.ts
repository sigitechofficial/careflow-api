import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
}
