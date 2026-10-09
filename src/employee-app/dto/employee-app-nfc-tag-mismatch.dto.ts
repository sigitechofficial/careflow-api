import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** App caught a wrong NFC tag (often offline) — tell the office. */
export class EmployeeAppNfcTagMismatchDto {
  @ApiProperty({ example: '04112233445566' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  nfcTagUid!: string;

  @ApiPropertyOptional({ description: 'When the carer scanned it (device time, ISO).' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  deviceRecordedAt?: string;
}
