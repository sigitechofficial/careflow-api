import { ApiPropertyOptional } from '@nestjs/swagger';
import { CarePathwayFormType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCareFormDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: CarePathwayFormType })
  @IsOptional()
  @IsEnum(CarePathwayFormType)
  formType?: CarePathwayFormType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Icon URL; pass null to clear' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pictureUrl?: string | null;
}
