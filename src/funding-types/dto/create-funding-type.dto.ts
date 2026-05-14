import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFundingTypeDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
