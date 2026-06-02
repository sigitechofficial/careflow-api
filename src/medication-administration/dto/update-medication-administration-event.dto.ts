import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MedicationAdministrationStatus } from '@prisma/client';

export class UpdateMedicationAdministrationEventDto {
  @ApiPropertyOptional({ description: 'MAR short code — maps to status enum' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  statusCode?: string;

  @ApiPropertyOptional({ enum: MedicationAdministrationStatus })
  @IsOptional()
  @IsEnum(MedicationAdministrationStatus)
  status?: MedicationAdministrationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  correctionReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correctionNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  doseGiven?: string;
}
