import { ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationStatusCodeFieldRequirement } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMedicationStatusCodeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ example: '#15803d' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @ApiPropertyOptional({ example: '#ffffff' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  textColor?: string;

  @ApiPropertyOptional({ enum: MedicationStatusCodeFieldRequirement })
  @IsOptional()
  @IsEnum(MedicationStatusCodeFieldRequirement)
  reasonRequirement?: MedicationStatusCodeFieldRequirement;

  @ApiPropertyOptional({ enum: MedicationStatusCodeFieldRequirement })
  @IsOptional()
  @IsEnum(MedicationStatusCodeFieldRequirement)
  managerReviewRequirement?: MedicationStatusCodeFieldRequirement;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
