import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LinkMedicationPackMemberDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'ServiceUserMedication to link into this pack. PRN and controlled drugs are rejected with 400.',
  })
  @IsUUID()
  serviceUserMedicationId!: string;
}
