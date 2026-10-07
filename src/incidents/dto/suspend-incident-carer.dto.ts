import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNotEmpty,
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

  @ApiProperty({ description: 'Why the carer is suspended while the incident is investigated' })
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

export class LiftIncidentCarerSuspensionDto {
  @ApiProperty({ description: 'Why the suspension is lifted' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class ExtendIncidentCarerSuspensionDto {
  @ApiProperty({ description: 'New end date (YYYY-MM-DD), after the current one', example: '2026-10-27' })
  @IsISO8601()
  suspendTo!: string;

  @ApiProperty({ description: 'Why the suspension is extended' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
