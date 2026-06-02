import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiDeleteResponseDto } from '../../common/dto/api-error-response.dto';

export class MedicationAllergyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiProperty({ example: 'Penicillin' })
  allergen!: string;

  @ApiPropertyOptional({ nullable: true })
  reaction!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;
}

export class MedicationAllergyListResponseDto {
  @ApiProperty({ type: [MedicationAllergyDto] })
  data!: MedicationAllergyDto[];
}

export { ApiDeleteResponseDto as MedicationAllergyDeleteResponseDto };
