import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationPrnChartEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'GIVEN' })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  doseGiven!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  scheduledDateTime!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  actualDateTime!: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Administering carer display name' })
  carer!: string | null;

  @ApiPropertyOptional({ nullable: true })
  prnReason!: string | null;

  @ApiPropertyOptional({ nullable: true })
  prnOutcome!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class MedicationPrnChartGroupDto {
  @ApiProperty({ example: 'Paracetamol 500mg' })
  medicationName!: string;

  @ApiProperty({ type: [MedicationPrnChartEventDto] })
  events!: MedicationPrnChartEventDto[];
}

export class MedicationPrnChartResponseDto {
  @ApiProperty({ example: '2026-05-01' })
  dateFrom!: string;

  @ApiProperty({ example: '2026-05-31' })
  dateTo!: string;

  @ApiProperty({ type: [MedicationPrnChartGroupDto] })
  groups!: MedicationPrnChartGroupDto[];
}
