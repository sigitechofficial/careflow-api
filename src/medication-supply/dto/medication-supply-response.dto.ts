import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationSupplySummaryDto {
  @ApiProperty({ enum: ['BLISTER_CYCLE', 'BOTTLE_28DAY', 'PRESCRIPTION_QTY'] })
  supplyModel!: string;

  @ApiPropertyOptional({ nullable: true })
  quantityRemaining!: number | null;

  @ApiPropertyOptional({ nullable: true })
  quantityTotal!: number | null;

  @ApiProperty({ example: 'tablets' })
  qtyUnit!: string;

  @ApiPropertyOptional({ nullable: true })
  daysRemaining!: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  deliveredAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  cycleEndDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  runsOutDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  openedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacyName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  packName!: string | null;
}

export class MedicationSupplyDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  deliveredAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  cycleEndDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  quantity!: number | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacyName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional()
  receivedBy?: { id: string; name: string } | null;

  @ApiPropertyOptional()
  witnessBy?: { id: string; name: string } | null;
}

export class MedicationSupplyCardDto {
  @ApiProperty({ format: 'uuid' })
  medicationId!: string;

  @ApiProperty({ type: [String] })
  relatedMedicationIds!: string[];

  @ApiProperty()
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true })
  packName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dose!: string | null;

  @ApiPropertyOptional({ type: MedicationSupplySummaryDto, nullable: true })
  supplySummary!: MedicationSupplySummaryDto | null;

  @ApiProperty({ type: [MedicationSupplyDeliveryDto] })
  recentDeliveries!: MedicationSupplyDeliveryDto[];
}

export class MedicationSupplyBundleResponseDto {
  @ApiProperty({ type: [MedicationSupplyCardDto] })
  medications!: MedicationSupplyCardDto[];
}
