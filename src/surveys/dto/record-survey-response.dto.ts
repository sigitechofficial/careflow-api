import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SurveyRespondentRelation } from '@prisma/client';
import {
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { SurveyAnswerItemDto } from './submit-survey-response.dto';

/** Channels office staff can record responses through. */
export const STAFF_RECORDED_CHANNELS = [
  'TELEPHONE',
  'PAPER',
  'IN_PERSON',
] as const;
export type StaffRecordedChannel = (typeof STAFF_RECORDED_CHANNELS)[number];

/** Fields shared by recording and correcting a staff-recorded response. */
class RecordedResponseDetailsDto {
  @ApiProperty({ type: [SurveyAnswerItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerItemDto)
  answers!: SurveyAnswerItemDto[];

  @ApiPropertyOptional({
    enum: SurveyRespondentRelation,
    description: 'Who gave the answers',
  })
  @IsOptional()
  @IsEnum(SurveyRespondentRelation)
  respondentRelation?: SurveyRespondentRelation;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Family member / representative / staff name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  respondentName?: string;

  @ApiPropertyOptional({
    description: 'Telephone: when the call took place (ISO date-time)',
  })
  @IsOptional()
  @IsDateString()
  contactedAt?: string;

  @ApiPropertyOptional({
    maxLength: 50,
    description: 'Telephone: number called',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactNumber?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Call / collection notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contactNotes?: string;
}

export class RecordSurveyResponseDto extends RecordedResponseDetailsDto {
  @ApiProperty({ enum: STAFF_RECORDED_CHANNELS })
  @IsIn(STAFF_RECORDED_CHANNELS)
  channel!: StaffRecordedChannel;

  @ApiPropertyOptional({
    description: 'Not linked to anyone; personId is ignored',
  })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Employee id or service user id (survey target)',
  })
  @IsOptional()
  @IsUUID()
  personId?: string;

  @ApiPropertyOptional({
    description: 'Telephone: the person agreed to answer over the phone',
  })
  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;
}

export class UpdateRecordedSurveyResponseDto extends RecordedResponseDetailsDto {
  @ApiProperty({
    maxLength: 1000,
    description: 'Why the recorded answers are being corrected',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
