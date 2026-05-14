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
import { MedicationAdministrationStatus } from '@prisma/client';

export class CreateMedicationAdministrationEventDto {
  @ApiProperty()
  @IsUUID()
  serviceUserMedicationId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  medicationScheduleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roundId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  administeredById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  actualDateTime?: string;

  @ApiProperty({ enum: MedicationAdministrationStatus })
  @IsEnum(MedicationAdministrationStatus)
  status!: MedicationAdministrationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  notGivenReasonId?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  doseGiven?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrn?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prnReason?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  prnOutcome?: string;
}
