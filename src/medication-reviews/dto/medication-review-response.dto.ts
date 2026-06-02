import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiDeleteResponseDto } from '../../common/dto/api-error-response.dto';

export class MedicationReviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reviewedById!: string | null;
}

export class MedicationReviewListResponseDto {
  @ApiProperty({ type: [MedicationReviewDto] })
  data!: MedicationReviewDto[];
}

export { ApiDeleteResponseDto as MedicationReviewDeleteResponseDto };
