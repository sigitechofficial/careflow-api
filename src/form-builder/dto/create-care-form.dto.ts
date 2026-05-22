import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCareFormDto {
  @ApiProperty({ example: 'Personal care assessment' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: CarePathwayFormType })
  @IsEnum(CarePathwayFormType)
  formType!: CarePathwayFormType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Icon URL (standard gallery path or uploaded form icon)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pictureUrl?: string;
}
