import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicationPackStatus, MedicationPackType } from '@prisma/client';
import { ApiDeleteResponseDto } from '../../common/dto/api-error-response.dto';
import { MedicationPackAdminRulesDto } from './medication-pack-admin-rules.dto';

export class MedicationPackItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  medicationPackId!: string;

  @ApiProperty({ example: 'Paracetamol' })
  medicationName!: string;

  @ApiPropertyOptional({ nullable: true, example: '500mg' })
  strength!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ example: 0 })
  sortOrder!: number;
}

export class MedicationPackDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiProperty({ example: 'Morning blister pack' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true })
  startDate!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  endDate!: Date | null;

  @ApiProperty({ enum: MedicationPackType, example: MedicationPackType.BLISTER })
  packType!: MedicationPackType;

  @ApiProperty({ enum: MedicationPackStatus, example: MedicationPackStatus.DRAFT })
  status!: MedicationPackStatus;

  @ApiProperty({ example: 1 })
  cycleNumber!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Morning & Evening' })
  roundLabel!: string | null;

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
  publishedAt!: Date | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  publishedById!: string | null;

  @ApiPropertyOptional({ nullable: true })
  supersededAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  endedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: 28 })
  cycleDurationDays!: number | null;

  @ApiPropertyOptional({ nullable: true })
  reviewDate!: Date | null;

  @ApiProperty({ example: false })
  prescriptionChecked!: boolean;

  @ApiPropertyOptional({ nullable: true })
  prescriptionCheckedBy!: string | null;

  @ApiPropertyOptional({ nullable: true })
  prescriptionCheckedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, example: 28 })
  generateAheadDays!: number | null;

  @ApiPropertyOptional({ type: MedicationPackAdminRulesDto, nullable: true })
  adminRules!: MedicationPackAdminRulesDto | null;

  @ApiPropertyOptional({ type: [MedicationPackItemDto] })
  items?: MedicationPackItemDto[];
}

export class MedicationPackListResponseDto {
  @ApiProperty({ type: [MedicationPackDto] })
  data!: MedicationPackDto[];
}

export { ApiDeleteResponseDto as MedicationPackDeleteResponseDto };
