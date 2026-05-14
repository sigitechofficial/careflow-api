import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MedicationKind, MedicationRecordStatus } from '@prisma/client';

export class CreateServiceUserMedicationDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  medicationName!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  strength?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  frequencyId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  frequencyText?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isControlledMedication?: boolean;

  @ApiProperty({ enum: MedicationKind })
  @IsEnum(MedicationKind)
  medicationKind!: MedicationKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationPackId?: string;

  @ApiPropertyOptional({ enum: MedicationRecordStatus })
  @IsOptional()
  @IsEnum(MedicationRecordStatus)
  status?: MedicationRecordStatus;
}
