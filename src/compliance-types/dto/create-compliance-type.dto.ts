import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateComplianceTypeDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ maxLength: 100, description: 'Unique machine code, e.g. DBS_CHECK' })
  @IsString()
  @MaxLength(100)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: ComplianceCategory })
  @IsEnum(ComplianceCategory)
  category!: ComplianceCategory;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  hasExpiry?: boolean = true;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  defaultValidityMonths?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresDocument?: boolean = true;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresVerification?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMandatoryByDefault?: boolean = false;
}
