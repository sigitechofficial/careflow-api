import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateServiceUserInventoryItemDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  itemName!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99_999)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  itemValue?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  description!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  location!: string;

  /** Calendar date only, `YYYY-MM-DD`. */
  @ApiProperty({ example: '2026-01-15' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateDeposited must be YYYY-MM-DD' })
  dateDeposited!: string;

  @ApiPropertyOptional({
    description: 'Optional PNG data URL from a signature pad (data:image/png;base64,...).',
    maxLength: 400_000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(400_000)
  witnessSignatureDataUrl?: string;
}
