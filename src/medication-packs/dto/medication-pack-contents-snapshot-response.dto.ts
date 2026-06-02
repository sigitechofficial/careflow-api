import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackType } from '@prisma/client';
import { MedicationPackManifestLineDto } from './medication-pack-manifest-response.dto';

export class MedicationPackContentsSnapshotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationPackId!: string;

  @ApiProperty({ example: 1 })
  cycleNumber!: number;

  @ApiProperty({ example: 'Morning & Evening blister pack' })
  packName!: string;

  @ApiProperty({ enum: MedicationPackType })
  packType!: MedicationPackType;

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

  @ApiProperty()
  publishedAt!: Date;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  publishedById!: string | null;

  @ApiProperty({ type: [MedicationPackManifestLineDto] })
  lines!: MedicationPackManifestLineDto[];
}
