import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentAttachmentCategory,
  IncidentInjurySeverity,
  IncidentPersonKind,
  IncidentRelatedRecordStatus,
  IncidentRelatedRecordType,
} from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateIncidentInjuryDto {
  @ApiProperty({ enum: IncidentPersonKind })
  @IsEnum(IncidentPersonKind)
  personKind!: IncidentPersonKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  personServiceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  personEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Name for an external person' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  personName?: string;

  @ApiProperty({ enum: IncidentInjurySeverity })
  @IsEnum(IncidentInjurySeverity)
  injurySeverity!: IncidentInjurySeverity;

  @ApiProperty({ example: 'Bruising' })
  @IsString()
  @MaxLength(200)
  injuryType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bodyRegion?: string;

  @ApiPropertyOptional({ description: 'LEFT / RIGHT / CENTRE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  side?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ example: '2cm x 1.5cm' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  measurements?: string;

  @ApiPropertyOptional({ description: 'Existing body-map record id to link' })
  @IsOptional()
  @IsUUID()
  bodyMapRecordId?: string;
}

export class CreateIncidentWitnessDto {
  @ApiProperty({ enum: IncidentPersonKind })
  @IsEnum(IncidentPersonKind)
  personKind!: IncidentPersonKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  personServiceUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  personEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  personName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  statement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  statementDate?: string;
}

export class LinkRelatedIncidentDto {
  @ApiProperty({ description: 'The other incident to link' })
  @IsUUID()
  relatedIncidentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateRelatedCareRecordDto {
  @ApiProperty({ enum: IncidentRelatedRecordType })
  @IsEnum(IncidentRelatedRecordType)
  recordType!: IncidentRelatedRecordType;

  @ApiProperty({ example: 'Falls Risk Assessment' })
  @IsString()
  @MaxLength(200)
  referenceLabel!: string;

  @ApiPropertyOptional({
    description: 'Id of the linked care record, if known',
  })
  @IsOptional()
  @IsUUID()
  externalId?: string;

  @ApiPropertyOptional({ enum: IncidentRelatedRecordStatus })
  @IsOptional()
  @IsEnum(IncidentRelatedRecordStatus)
  status?: IncidentRelatedRecordStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateRelatedCareRecordDto {
  @ApiPropertyOptional({ enum: IncidentRelatedRecordStatus })
  @IsOptional()
  @IsEnum(IncidentRelatedRecordStatus)
  status?: IncidentRelatedRecordStatus;

  @ApiPropertyOptional({ description: 'Who updated the record (label)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  updatedByLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateIncidentAttachmentMetaDto {
  @ApiPropertyOptional({ enum: IncidentAttachmentCategory })
  @IsOptional()
  @IsEnum(IncidentAttachmentCategory)
  category?: IncidentAttachmentCategory;
}
