import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ComplaintOutcome,
  ComplaintSeverity,
  FeedbackChannel,
  FeedbackFromKind,
  FeedbackStatus,
  FeedbackType,
} from '@prisma/client';
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
} from 'class-validator';
import type { FeedbackAction } from '../feedback-workflow.util';

const FEEDBACK_ACTIONS: FeedbackAction[] = [
  'ACKNOWLEDGE',
  'START_INVESTIGATION',
  'RESPOND',
  'CLOSE',
  'REOPEN',
  'SHARE',
];

/** Editable details shared by create and update. */
class FeedbackDetailsDto {
  @ApiProperty({ description: 'When it was received (ISO)' })
  @IsDateString()
  receivedAt!: string;

  @ApiProperty({ enum: FeedbackChannel })
  @IsEnum(FeedbackChannel)
  channel!: FeedbackChannel;

  @ApiProperty({ enum: FeedbackFromKind })
  @IsEnum(FeedbackFromKind)
  fromKind!: FeedbackFromKind;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromName?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  fromContact?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fromServiceUserId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fromEmployeeId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  aboutServiceUserId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  aboutEmployeeIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Branch when no service user',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  details!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ enum: ComplaintSeverity })
  @IsOptional()
  @IsEnum(ComplaintSeverity)
  severity?: ComplaintSeverity | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  desiredOutcome?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Employee handling it',
  })
  @IsOptional()
  @IsUUID()
  handlerEmployeeId?: string | null;
}

export class CreateFeedbackDto extends FeedbackDetailsDto {
  @ApiProperty({ enum: FeedbackType })
  @IsEnum(FeedbackType)
  type!: FeedbackType;
}

export class UpdateFeedbackDto extends PartialType(FeedbackDetailsDto) {
  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  investigationNotes?: string;
}

export class FeedbackTransitionDto {
  @ApiProperty({ enum: FEEDBACK_ACTIONS })
  @IsIn(FEEDBACK_ACTIONS)
  action!: FeedbackAction;

  @ApiPropertyOptional({
    description: 'When it happened (ISO); now if omitted',
  })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @ApiPropertyOptional({ maxLength: 10000, description: 'RESPOND' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  responseSummary?: string;

  @ApiPropertyOptional({
    enum: ComplaintOutcome,
    description: 'RESPOND / CLOSE',
  })
  @IsOptional()
  @IsEnum(ComplaintOutcome)
  outcome?: ComplaintOutcome;

  @ApiPropertyOptional({ maxLength: 10000, description: 'CLOSE' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  lessonsLearned?: string;
}

export class FeedbackNoteDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  note!: string;
}

export class DeleteFeedbackDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class FeedbackListQueryDto {
  @ApiPropertyOptional({ enum: FeedbackType })
  @IsOptional()
  @IsEnum(FeedbackType)
  type?: FeedbackType;

  @ApiPropertyOptional({
    description: 'Status, or OPEN for anything not closed',
  })
  @IsOptional()
  @IsIn([...Object.values(FeedbackStatus), 'OPEN'])
  status?: FeedbackStatus | 'OPEN';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Received on or after (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Received on or before (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Reference, subject, name or details' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
