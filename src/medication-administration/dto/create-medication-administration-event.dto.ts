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

  @ApiPropertyOptional({ description: 'Employee who administered (carer)' })
  @IsOptional()
  @IsUUID()
  administeredById?: string;

  @ApiPropertyOptional({
    description: 'When true with administeredById, current user is stored as enteredById',
  })
  @IsOptional()
  @IsBoolean()
  recordOnBehalfOfCarer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledDateTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  actualDateTime?: string;

  @ApiPropertyOptional({
    description: 'MAR short code (G, R, N, …). When set, maps to status enum server-side.',
    example: 'G',
  })
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

  @ApiPropertyOptional({
    description:
      'Controlled-drug witness. false = No. true = Yes (name + relation required).',
  })
  @IsOptional()
  @IsBoolean()
  witnessPresent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  witnessName?: string;

  @ApiPropertyOptional({ example: 'RELATIVE' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  witnessRelationCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  witnessRelationDetail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  witnessNotes?: string;
}
