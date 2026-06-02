import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-error-response.dto';

export class MedicationStatusCodeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'G' })
  code!: string;

  @ApiProperty({ example: 'Given' })
  label!: string;

  @ApiProperty({ example: '#2E7D32' })
  color!: string;

  @ApiProperty({ example: '#FFFFFF' })
  textColor!: string;

  @ApiProperty({ example: 'ADMINISTERED' })
  category!: string;

  @ApiProperty({ example: 'NONE' })
  reasonRequirement!: string;

  @ApiProperty({ example: 'NOT_REQUIRED' })
  managerReviewRequirement!: string;

  @ApiProperty({ example: 1 })
  sortOrder!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class MedicationStatusCodeListResponseDto {
  @ApiProperty({ type: [MedicationStatusCodeDto] })
  data!: MedicationStatusCodeDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class MedicationStatusCodeActiveListResponseDto {
  @ApiProperty({ type: [MedicationStatusCodeDto] })
  data!: MedicationStatusCodeDto[];
}

export class MedicationStatusCodeSingleResponseDto {
  @ApiProperty({ type: MedicationStatusCodeDto })
  data!: MedicationStatusCodeDto;
}
