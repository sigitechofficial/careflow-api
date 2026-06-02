import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-error-response.dto';

export class MedicationReportServiceUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Alex' })
  firstName!: string;

  @ApiProperty({ example: 'Taylor' })
  lastName!: string;

  @ApiPropertyOptional({ example: 'SU-00142' })
  serviceUserNumber?: string;
}

export class MedicationReportMedicationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Atorvastatin 20mg' })
  medicationName!: string;

  @ApiPropertyOptional()
  category?: { name: string };
}

export class MedicationReportPersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  personalDetail?: { firstName: string; lastName: string };

  @ApiPropertyOptional({ example: 'Jane Smith' })
  name?: string;
}

export class MedicationAdministeredReportRowDto {
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
  actualDateTime!: Date | null;

  @ApiPropertyOptional({ type: MedicationReportMedicationDto })
  medication?: MedicationReportMedicationDto;

  @ApiPropertyOptional({ type: MedicationReportServiceUserDto })
  serviceUser?: MedicationReportServiceUserDto;

  @ApiPropertyOptional({ type: MedicationReportPersonDto })
  administeredBy?: MedicationReportPersonDto;
}

export class MedicationLateAdministrationReportRowDto extends MedicationAdministeredReportRowDto {
  @ApiProperty({ example: 45, description: 'Minutes after scheduled time' })
  delayMinutes!: number;

  @ApiProperty({ example: true })
  isLate!: boolean;
}

export class MedicationStockReportRowDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  movementDate!: Date;

  @ApiProperty({ example: 'DELIVERY' })
  movementType!: string;

  @ApiPropertyOptional({ nullable: true })
  quantity!: number | null;

  @ApiPropertyOptional({ type: MedicationReportMedicationDto })
  medication?: MedicationReportMedicationDto;
}

export class MedicationReportListResponseDto {
  @ApiProperty({ type: [MedicationAdministeredReportRowDto] })
  data!: MedicationAdministeredReportRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto & { total?: number; lateThresholdMinutes?: number };
}

export class MedicationStockReportListResponseDto {
  @ApiProperty({ type: [MedicationStockReportRowDto] })
  data!: MedicationStockReportRowDto[];

  @ApiProperty()
  meta!: { total: number };
}

export class MedicationLateReportListResponseDto {
  @ApiProperty({ type: [MedicationLateAdministrationReportRowDto] })
  data!: MedicationLateAdministrationReportRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto & { lateThresholdMinutes?: number };
}
