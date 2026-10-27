import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LinkServiceUserDto {
  @ApiProperty({ format: 'uuid', description: 'The service user created from this enquiry.' })
  @IsUUID()
  serviceUserId!: string;
}
