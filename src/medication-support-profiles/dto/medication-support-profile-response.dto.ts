import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MedicationSupportProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceUserId!: string;

  @ApiProperty({ example: false })
  selfAdministersMedication!: boolean;

  @ApiProperty({ example: true })
  requiresPrompting!: boolean;

  @ApiProperty({ example: false })
  requiresSupervision!: boolean;

  @ApiProperty({ example: true })
  requiresCarerAdministration!: boolean;

  @ApiProperty({
    example: false,
    description:
      'Family member or carer gives medicines support (CQC / NICE NG67).',
  })
  familyMemberOrCarerSupportsMedication!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Where medicines are kept in the property (carer visit overview).',
    example: 'Kitchen cupboard, above the sink (left-hand side, labelled “MAR”).',
  })
  storageLocation!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;
}
