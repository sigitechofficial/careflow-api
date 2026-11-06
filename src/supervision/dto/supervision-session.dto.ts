import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SupervisionFormat, SupervisionSessionStatus } from '@prisma/client';

export class CreateSupervisionSessionDto {
  @ApiProperty({ description: 'Review type (e.g. Supervision); its Care Pathway form is used for the record.' })
  @IsUUID()
  reviewTypeId!: string;

  @ApiProperty({ type: [String], description: 'Carers in the session (more than one for GROUP).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  employeeIds!: string[];

  @ApiPropertyOptional({ enum: SupervisionFormat, default: SupervisionFormat.ONE_TO_ONE })
  @IsOptional()
  @IsEnum(SupervisionFormat)
  format?: SupervisionFormat;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @ApiPropertyOptional({ description: 'Defaults to the signed-in user.' })
  @IsOptional()
  @IsUUID()
  supervisorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ description: 'Visit observed (OBSERVED_PRACTICE).' })
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string;
}

/** Only while SCHEDULED / IN_PROGRESS (before the supervisor signs). */
export class UpdateSupervisionSessionDto {
  @ApiPropertyOptional({ enum: SupervisionFormat })
  @IsOptional()
  @IsEnum(SupervisionFormat)
  format?: SupervisionFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  heldAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  scheduledJobId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  summary?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Needs supervision.read_confidential.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  confidentialNotes?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'boolean' }] },
    description: 'Form answers to change, keyed sectionId:fieldId from the session form. Empty or null clears one.',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, string | boolean | null>;
}

export class ListSupervisionSessionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: SupervisionSessionStatus })
  @IsOptional()
  @IsEnum(SupervisionSessionStatus)
  status?: SupervisionSessionStatus;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SupervisorSignDto {
  @ApiProperty({ description: 'Signature image (data URL from the signature pad).' })
  @IsString()
  @MinLength(20)
  @MaxLength(500000)
  signature!: string;
}

export class AttendeeSignDto {
  @ApiPropertyOptional({ description: 'Signature image (data URL). Optional only when the carer disagrees and comments.' })
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  signature?: string;

  @ApiProperty({ description: 'False when the carer does not agree with the record.' })
  @IsBoolean()
  agrees!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

export class CancelSupervisionSessionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CreateSupervisionAddendumDto {
  @ApiProperty({ description: 'Correction or later note on a signed session (who and when are recorded).' })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  text!: string;
}
