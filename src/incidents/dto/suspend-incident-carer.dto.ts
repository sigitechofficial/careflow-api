import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SuspendIncidentCarerDto {
  @ApiPropertyOptional({
    description:
      'Employee to suspend. Defaults to the incident primary employee when omitted.',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ description: 'Reason for suspending the carer after investigation' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  reason!: string;

  @ApiProperty({
    description: 'Suspension start date (ISO 8601 date or datetime)',
    example: '2026-09-29',
  })
  @IsISO8601()
  suspendFrom!: string;

  @ApiProperty({
    description: 'Suspension end date (ISO 8601 date or datetime)',
    example: '2026-10-13',
  })
  @IsISO8601()
  suspendTo!: string;
}
