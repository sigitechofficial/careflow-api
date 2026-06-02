import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiDeleteResponseDto, PaginationMetaDto } from '../../common/dto/api-error-response.dto';

export class ServiceUserMedicationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiProperty({ example: 'Atorvastatin' })
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiProperty({ enum: ['REGULAR', 'PRN'] })
  medicationKind!: string;

  @ApiProperty({ enum: ['ACTIVE', 'ON_HOLD', 'DISCONTINUED', 'PENDING'] })
  status!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  startDate!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endDate!: Date | null;

  @ApiPropertyOptional({ description: 'Nested type, route, category, schedules when included' })
  medicationType?: unknown;

  @ApiPropertyOptional()
  schedules?: unknown[];
}

export class ServiceUserMedicationListResponseDto {
  @ApiProperty({ type: [ServiceUserMedicationDto] })
  data!: ServiceUserMedicationDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class ServiceUserMedicationStatusPatchResponseDto {
  @ApiProperty({ type: ServiceUserMedicationDto })
  data!: ServiceUserMedicationDto;

  @ApiPropertyOptional({
    description: 'Allergy warnings triggered by status change',
    type: 'array',
    items: { type: 'object' },
  })
  meta?: { allergyWarnings?: unknown[] };
}

export { ApiDeleteResponseDto as ServiceUserMedicationDeleteResponseDto };
