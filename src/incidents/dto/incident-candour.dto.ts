import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CANDOUR_ATTEMPT_METHODS,
  CANDOUR_DECISIONS,
  CANDOUR_HARM_TYPES,
  CANDOUR_LETTER_METHODS,
  CANDOUR_TOLD_PERSON_KINDS,
  CANDOUR_UNABLE_REASONS,
} from '../incident-candour.util';

/** Any change to something already recorded needs a reason (kept on the timeline). */
class CandourChangeReason {
  @ApiPropertyOptional({ description: 'Required when changing something already recorded' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeReason?: string;
}

export class CandourDecisionDto extends CandourChangeReason {
  @ApiProperty({ enum: CANDOUR_DECISIONS })
  @IsIn(CANDOUR_DECISIONS)
  decision!: string;

  @ApiPropertyOptional({ description: 'Required for No / Not applicable' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  decisionReason?: string | null;

  @ApiPropertyOptional({ enum: CANDOUR_HARM_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CANDOUR_HARM_TYPES.length)
  @IsIn(CANDOUR_HARM_TYPES, { each: true })
  harmTypes?: string[];

  @ApiPropertyOptional({ description: 'Health professional consulted (Reg 20(9))' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  healthProfessionalName?: string | null;

  @ApiPropertyOptional({ description: 'e.g. GP, district nurse, paramedic' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  healthProfessionalRole?: string | null;

  @ApiPropertyOptional({ description: 'When the professional is a staff member' })
  @IsOptional()
  @IsUUID()
  healthProfessionalEmployeeId?: string | null;
}

export class CandourToldDto extends CandourChangeReason {
  @ApiProperty({ example: '2026-10-08' })
  @IsISO8601()
  toldOn!: string;

  @ApiProperty({ description: 'Staff member who told them' })
  @IsUUID()
  toldByEmployeeId!: string;

  @ApiProperty({ enum: CANDOUR_TOLD_PERSON_KINDS })
  @IsIn(CANDOUR_TOLD_PERSON_KINDS)
  toldPersonKind!: string;

  @ApiPropertyOptional({ description: 'Required when a representative was told' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  toldPersonName?: string | null;

  @ApiPropertyOptional({ description: 'e.g. daughter, lasting power of attorney' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  toldRelationship?: string | null;

  @ApiProperty() @IsBoolean() factsExplained!: boolean;
  @ApiProperty() @IsBoolean() enquiriesExplained!: boolean;
  @ApiProperty() @IsBoolean() apologyGiven!: boolean;

  @ApiProperty({ description: 'Reasonable support offered (Reg 20(2)(b))' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  supportOffered!: string;
}

export class CandourWrittenDto extends CandourChangeReason {
  @ApiProperty() @IsISO8601() writtenSentOn!: string;
  @ApiProperty() @IsUUID() writtenByEmployeeId!: string;
  @ApiProperty({ enum: CANDOUR_LETTER_METHODS }) @IsIn(CANDOUR_LETTER_METHODS) writtenMethod!: string;
  @ApiProperty({ description: 'Copy of the letter / email (incident attachment)' })
  @IsUUID()
  writtenAttachmentId!: string;
}

export class CandourResultsDto extends CandourChangeReason {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() resultsSharedOn?: string | null;
  @ApiPropertyOptional({ enum: CANDOUR_LETTER_METHODS })
  @IsOptional()
  @IsIn(CANDOUR_LETTER_METHODS)
  resultsMethod?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resultsAttachmentId?: string | null;

  @ApiPropertyOptional({ description: 'Instead of a results letter, when there was no investigation' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  noFurtherEnquiriesReason?: string | null;
}

export class CandourUnableDto extends CandourChangeReason {
  @ApiProperty({ description: 'false = they can be told after all' })
  @IsBoolean()
  unableToNotify!: boolean;

  @ApiPropertyOptional({ enum: CANDOUR_UNABLE_REASONS })
  @IsOptional()
  @IsIn(CANDOUR_UNABLE_REASONS)
  unableReason?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) unableNote?: string | null;
}

export class CandourAttemptDto {
  @ApiProperty() @IsISO8601() attemptedOn!: string;
  @ApiProperty({ enum: CANDOUR_ATTEMPT_METHODS }) @IsIn(CANDOUR_ATTEMPT_METHODS) method!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() byEmployeeId?: string | null;
  @ApiProperty({ description: 'What happened, e.g. no answer, number not in use' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  outcome!: string;
}
