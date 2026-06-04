import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class OpenFdaDrugLabelSearchQueryDto {
  @ApiProperty({ description: 'Medicine name fragment (min 2 characters)' })
  @IsString()
  @MinLength(2)
  q!: string;

  @ApiPropertyOptional({ default: 8, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class OpenFdaDrugLabelHitDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional()
  brandName?: string;

  @ApiPropertyOptional()
  genericName?: string;

  @ApiProperty({ type: [String] })
  substanceNames!: string[];

  @ApiProperty({ type: [String] })
  routes!: string[];

  @ApiPropertyOptional()
  dosageFormHint?: string;

  @ApiPropertyOptional()
  purpose?: string;

  @ApiPropertyOptional()
  indications?: string;

  @ApiPropertyOptional()
  activeIngredient?: string;

  @ApiPropertyOptional()
  doseHint?: string;

  @ApiProperty()
  isControlledHint!: boolean;

  @ApiPropertyOptional()
  productType?: string;
}

export class OpenFdaDrugLabelSearchResponseDto {
  @ApiProperty({ type: [OpenFdaDrugLabelHitDto] })
  data!: OpenFdaDrugLabelHitDto[];

  @ApiProperty()
  message!: string;
}
