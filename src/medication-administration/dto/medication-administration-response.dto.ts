import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-error-response.dto';

export class MedicationEventMedicationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Atorvastatin 20mg' })
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiPropertyOptional({ nullable: true })
  strength!: string | null;
}

export class MedicationEventRoundSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Morning' })
  name!: string;

  @ApiProperty({ example: '08:00' })
  time!: string;
}

export class MedicationEventScheduleSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: '08:00', nullable: true })
  dueTime!: string | null;

  @ApiPropertyOptional({ type: MedicationEventRoundSummaryDto })
  round?: MedicationEventRoundSummaryDto;
}

export class MedicationEventPersonSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Jane Smith' })
  name!: string;
}

export class MedicationAdministrationEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserMedicationId!: string;

  @ApiProperty({ example: 'GIVEN' })
  status!: string;

  @ApiPropertyOptional({ example: 'G', nullable: true })
  statusCode!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  scheduledDateTime!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  actualDateTime!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  doseGiven!: string | null;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ example: false })
  isPrn!: boolean;

  @ApiPropertyOptional({ nullable: true })
  prnReason!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  managerReviewedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ type: MedicationEventMedicationSummaryDto })
  medication?: MedicationEventMedicationSummaryDto;

  @ApiPropertyOptional({ type: MedicationEventScheduleSummaryDto })
  schedule?: MedicationEventScheduleSummaryDto;

  @ApiPropertyOptional({ type: MedicationEventPersonSummaryDto })
  administeredBy?: MedicationEventPersonSummaryDto;

  @ApiPropertyOptional({
    type: MedicationEventPersonSummaryDto,
    description: 'Set when recorded on behalf of another carer',
  })
  enteredBy?: MedicationEventPersonSummaryDto | null;
}

export class MedicationAdministrationEventListResponseDto {
  @ApiProperty({ type: [MedicationAdministrationEventDto] })
  data!: MedicationAdministrationEventDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
