import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ServiceUserSharingBasis,
  ServiceUserSharingExceptionReason,
  ServiceUserSharingRecipientKind,
} from '@prisma/client';
import {
  CONSENT_CHANGE_ANSWERS,
  CONSENT_METHODS,
  CONSENT_TOPIC_KEYS,
  INFORMATION_FORMAT_KEYS,
  SHARING_CATEGORY_KEYS,
  SHARING_CHANNEL_KEYS,
} from '../service-user-privacy.util';

export class SaveCommunicationNeedsDto {
  @ApiProperty()
  @IsBoolean()
  interpreterNeeded!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  interpreterLanguage?: string;

  @ApiProperty({ enum: INFORMATION_FORMAT_KEYS, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(INFORMATION_FORMAT_KEYS, { each: true })
  formats!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  hearing?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sight?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Send written information to this contact instead.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  contactViaContactId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'The assessment these were taken from, when filled from it.' })
  @IsOptional()
  @IsUUID()
  fromAssessmentId?: string;
}

export class SaveSharingAgreementDto {
  @ApiProperty({ enum: ServiceUserSharingRecipientKind })
  @IsEnum(ServiceUserSharingRecipientKind)
  recipientKind!: ServiceUserSharingRecipientKind;

  @ApiPropertyOptional({ description: 'Required when recipientKind is CONTACT.' })
  @ValidateIf((o: SaveSharingAgreementDto) => o.recipientKind === ServiceUserSharingRecipientKind.CONTACT)
  @IsUUID()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Required unless a contact is chosen.' })
  @ValidateIf((o: SaveSharingAgreementDto) => o.recipientKind !== ServiceUserSharingRecipientKind.CONTACT)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  recipientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  recipientRole?: string;

  @ApiProperty({ enum: SHARING_CATEGORY_KEYS, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(SHARING_CATEGORY_KEYS, { each: true })
  categories!: string[];

  @ApiProperty({ enum: SHARING_CHANNEL_KEYS, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(SHARING_CHANNEL_KEYS, { each: true })
  channels!: string[];

  @ApiProperty({ enum: ServiceUserSharingBasis })
  @IsEnum(ServiceUserSharingBasis)
  basis!: ServiceUserSharingBasis;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  legalAuthorityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conditions?: string;

  @ApiProperty({ example: '2026-11-08' })
  @IsDateString({ strict: true })
  startsOn!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString({ strict: true })
  endsOn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString({ strict: true })
  reviewOn?: string | null;
}

export class StopSharingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class RecordSharingExceptionDto {
  @ApiProperty({ example: '2026-11-08' })
  @IsDateString({ strict: true })
  sharedOn!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sharedWith!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  whatShared!: string;

  @ApiProperty({ enum: ServiceUserSharingExceptionReason })
  @IsEnum(ServiceUserSharingExceptionReason)
  reason!: ServiceUserSharingExceptionReason;

  @ApiProperty({ description: 'Who decided (name and role).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  decidedBy!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class RecordConsentChangeDto {
  @ApiProperty({ enum: CONSENT_TOPIC_KEYS })
  @IsIn(CONSENT_TOPIC_KEYS)
  topic!: string;

  @ApiPropertyOptional({ description: 'Required for OTHER: what the consent is about.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ enum: CONSENT_CHANGE_ANSWERS })
  @IsIn([...CONSENT_CHANGE_ANSWERS])
  answer!: string;

  @ApiPropertyOptional({ enum: Object.keys(CONSENT_METHODS) })
  @IsOptional()
  @IsIn(Object.keys(CONSENT_METHODS))
  method?: string;

  @ApiPropertyOptional({ description: 'Who gave or refused it, or made the best-interests decision.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  givenBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  details?: string;

  @ApiProperty({ example: '2026-11-08' })
  @IsDateString({ strict: true })
  decidedOn!: string;
}
