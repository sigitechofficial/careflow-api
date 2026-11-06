import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** Checked in full by survey-event-triggers.util.ts (checkEventTriggerInput). */
export class SaveSurveyEventTriggerDto {
  @ApiProperty({
    description:
      '{ event, delayDays, windowDays, exclusions, options, checkFirst, lookBackDays?, ownerKey? }, or null to switch it off',
    nullable: true,
    type: Object,
  })
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  trigger!: Record<string, unknown> | null;
}

export class DecideEventSendsDto {
  @ApiProperty({ type: [String], description: 'Rows waiting for a decision' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiProperty({ enum: ['SEND', 'DONT_SEND', 'OFFERED'] })
  @IsIn(['SEND', 'DONT_SEND', 'OFFERED'])
  action!: 'SEND' | 'DONT_SEND' | 'OFFERED';

  @ApiPropertyOptional({ description: "Why not (required for DONT_SEND, 5–300 characters); how it was offered (optional)" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
