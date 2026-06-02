import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MedicationPackCondition,
  MedicationPackDeliveryLineState,
  MedicationPackDeliveryStatus,
} from '@prisma/client';

export class MedicationPackDeliveryLineDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  serviceUserMedicationId!: string | null;

  @ApiProperty()
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true })
  strength!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiProperty()
  expectedOnSnapshot!: boolean;

  @ApiProperty({ enum: MedicationPackDeliveryLineState })
  state!: MedicationPackDeliveryLineState;

  @ApiProperty()
  confirmedPresent!: boolean;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class MedicationPackDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationPackId!: string;

  @ApiProperty()
  cycleNumber!: number;

  @ApiProperty({ enum: MedicationPackDeliveryStatus })
  status!: MedicationPackDeliveryStatus;

  @ApiProperty()
  receivedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  deliveredBy!: string | null;

  @ApiPropertyOptional({ nullable: true })
  batchReference!: string | null;

  @ApiProperty({ enum: MedicationPackCondition })
  condition!: MedicationPackCondition;

  @ApiPropertyOptional({ nullable: true })
  conditionNotes!: string | null;

  @ApiPropertyOptional({ nullable: true })
  countersignedAt!: Date | null;

  @ApiProperty({ type: [MedicationPackDeliveryLineDto] })
  lines!: MedicationPackDeliveryLineDto[];
}
