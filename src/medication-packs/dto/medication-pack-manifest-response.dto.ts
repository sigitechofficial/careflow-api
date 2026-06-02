import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackType } from '@prisma/client';

export class MedicationPackManifestLineDto {
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

  @ApiPropertyOptional({ nullable: true })
  routeName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  instructions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  roundLabels!: string | null;

  @ApiPropertyOptional({ nullable: true })
  tabletDescription!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class MedicationPackManifestDto {
  @ApiProperty({ format: 'uuid' })
  packId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Snapshot id (null if not yet published)' })
  snapshotId!: string | null;

  @ApiProperty()
  packName!: string;

  @ApiProperty({ enum: MedicationPackType })
  packType!: MedicationPackType;

  @ApiProperty()
  cycleNumber!: number;

  @ApiProperty({ description: 'PUBLISHED if from an immutable snapshot, LIVE if computed from current members' })
  source!: 'PUBLISHED' | 'LIVE';

  @ApiPropertyOptional({ nullable: true })
  pharmacyName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacyPhone!: string | null;

  @ApiPropertyOptional({ nullable: true })
  gpName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  gpSurgery!: string | null;

  @ApiPropertyOptional({ nullable: true })
  nhsNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  startDate!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  endDate!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  publishedAt!: Date | null;

  @ApiProperty({ type: [MedicationPackManifestLineDto] })
  lines!: MedicationPackManifestLineDto[];
}
