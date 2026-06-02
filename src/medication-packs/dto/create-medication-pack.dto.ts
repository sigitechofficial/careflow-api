import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MedicationPackAdminRulesDto } from './medication-pack-admin-rules.dto';

export class CreateMedicationPackDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: MedicationPackType, default: MedicationPackType.BLISTER })
  @IsOptional()
  @IsEnum(MedicationPackType)
  packType?: MedicationPackType;

  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Cycle number for this pack' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cycleNumber?: number;

  @ApiPropertyOptional({ maxLength: 200, description: 'Round label, e.g. "Morning & Evening"' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  roundLabel?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pharmacyName?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  pharmacyPhone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gpName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gpSurgery?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nhsNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Pack cycle length in days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cycleDurationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  prescriptionChecked?: boolean;

  @ApiPropertyOptional({ maxLength: 200, description: 'Staff name or identifier who checked the prescription' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  prescriptionCheckedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  prescriptionCheckedAt?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Days ahead to generate administration records' })
  @IsOptional()
  @IsInt()
  @Min(1)
  generateAheadDays?: number;

  @ApiPropertyOptional({ type: MedicationPackAdminRulesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MedicationPackAdminRulesDto)
  adminRules?: MedicationPackAdminRulesDto;
}
