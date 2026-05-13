import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateServiceUserAllergyDto {
  @ApiPropertyOptional({ description: 'Pick from allergy catalog when using the dropdown.' })
  @IsOptional()
  @IsUUID()
  allergyCatalogId?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Free-text allergy name when not using catalog (or override label).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  allergyName?: string;

  @ApiProperty({ maxLength: 20_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  comment!: string;
}
