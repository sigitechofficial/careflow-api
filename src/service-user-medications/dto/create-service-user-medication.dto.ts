import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MedicationKind,
  MedicationRecordStatus,
  MedicationSchedulePattern,
} from '@prisma/client';
import { CreateMedicationScheduleItemDto } from './create-medication-schedule-item.dto';

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

  @ApiPropertyOptional({ maxLength: 2000, description: 'Why this medicine is prescribed' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reasonForMedication?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'How to give this medicine (carer-facing)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Office-only medication notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'How assisted (free text or lookup label)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  howAssisted?: string;

  @ApiPropertyOptional({ description: 'Repeat every N days (daily = 1)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyIntervalDays?: number;

  @ApiPropertyOptional({ enum: MedicationSchedulePattern })
  @IsOptional()
  @IsEnum(MedicationSchedulePattern)
  schedulePattern?: MedicationSchedulePattern;

  @ApiPropertyOptional({
    description: 'Day of month (1–31) when schedulePattern is MONTHLY and monthlyAnchorToStartDate is false',
    minimum: 1,
    maximum: 31,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthlyDayOfMonth?: number;

  @ApiPropertyOptional({
    description: 'When true, monthly doses fall on the same calendar day as startDate',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  monthlyAnchorToStartDate?: boolean;

  @ApiPropertyOptional({
    type: [CreateMedicationScheduleItemDto],
    description:
      'One row per administration time (e.g. 3 times daily → 3 schedule rows for carer MAR check-off)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateMedicationScheduleItemDto)
  schedules?: CreateMedicationScheduleItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isControlledMedication?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDecongestantMedication?: boolean;

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
