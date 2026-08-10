import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateBodyMapRecordDto } from '../../body-map/dto/create-body-map-record.dto';

/** Same payload as admin POST /body-map/records except serviceUserId (derived from the visit). */
export class EmployeeAppCreateBodyMapRecordDto extends OmitType(CreateBodyMapRecordDto, [
  'serviceUserId',
] as const) {
  @ApiProperty({ example: '2026-08-07T10:15:00.000Z' })
  @IsISO8601()
  deviceRecordedAt!: string;

  @ApiProperty({ example: 'bm-visit-abc-001' })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Optional client-side draft id before server assigns record id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientEntryId?: string;
}
