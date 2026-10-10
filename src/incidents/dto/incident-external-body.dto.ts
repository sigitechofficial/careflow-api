import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  EXTERNAL_BODY_ROLES,
  EXTERNAL_BODY_STATUSES,
  EXTERNAL_BODY_TYPES,
} from '../incident-external-body.util';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateIncidentExternalBodyDto {
  @ApiProperty({ enum: EXTERNAL_BODY_TYPES })
  @IsIn(EXTERNAL_BODY_TYPES)
  bodyType!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'e.g. Leeds City Council (required for OTHER)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  organisationName?: string | null;

  @ApiProperty({
    example: '2026-10-07',
    description: 'When it was referred to them (YYYY-MM-DD)',
  })
  @Matches(DATE_ONLY, { message: 'referredOn must be YYYY-MM-DD' })
  referredOn!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Their reference (crime ref, safeguarding case no.)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  contactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50)
  contactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  contactEmail?: string | null;

  @ApiProperty({ enum: EXTERNAL_BODY_ROLES })
  @IsIn(EXTERNAL_BODY_ROLES)
  role!: string;

  @ApiProperty({ enum: EXTERNAL_BODY_STATUSES })
  @IsIn(EXTERNAL_BODY_STATUSES)
  status!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Required once CONCLUDED / NO_FURTHER_ACTION',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  outcome?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'YYYY-MM-DD' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE_ONLY, { message: 'outcomeDate must be YYYY-MM-DD' })
  outcomeDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'What we gave them (records, statements…) and when',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  informationProvided?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'What we received from them (updates, findings, instructions)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  informationReceived?: string | null;
}

export class UpdateIncidentExternalBodyDto extends PartialType(
  CreateIncidentExternalBodyDto,
) {}

export class RemoveIncidentExternalBodyDto {
  @ApiProperty({
    description: 'Why the record is removed (e.g. added by mistake)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
