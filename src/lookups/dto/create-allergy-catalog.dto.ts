import { AllergyCatalogCategory } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateAllergyCatalogDto {
  @ApiProperty({ example: 'Peanuts' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'PEANUTS' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ enum: AllergyCatalogCategory, example: AllergyCatalogCategory.FOOD })
  @IsOptional()
  @IsEnum(AllergyCatalogCategory)
  category?: AllergyCatalogCategory;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
