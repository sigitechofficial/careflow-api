import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormFieldType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SaveCareFormFieldDto {
  @ApiPropertyOptional({ description: 'Existing field id; omit for new fields' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  label!: string;

  @ApiProperty({ enum: CarePathwayFormFieldType })
  @IsEnum(CarePathwayFormFieldType)
  fieldType!: CarePathwayFormFieldType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  placeholder?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  helpText?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  optionsJson?: unknown;

  @ApiProperty({ default: 0 })
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class SaveCareFormSectionDto {
  @ApiPropertyOptional({ description: 'Existing section id; omit for new sections' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ default: 0 })
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ type: [SaveCareFormFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCareFormFieldDto)
  fields!: SaveCareFormFieldDto[];
}

export class SaveCareFormSchemaDto {
  @ApiProperty({ type: [SaveCareFormSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveCareFormSectionDto)
  sections!: SaveCareFormSectionDto[];
}
