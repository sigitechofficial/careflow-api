import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const AUDIENCES = ['EVERYONE', 'ALLOWED_ONLY'] as const;
/** An address ("sam@nhs.net") or a whole domain ("@allforcare.co.uk"). */
const EMAIL_OR_DOMAIN = /^([^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$/;

export class UpdateMessageDeliveryDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() textEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pushEnabled?: boolean;

  @ApiPropertyOptional({ enum: AUDIENCES }) @IsOptional() @IsIn(AUDIENCES) emailAudience?: (typeof AUDIENCES)[number];
  @ApiPropertyOptional({ enum: AUDIENCES }) @IsOptional() @IsIn(AUDIENCES) textAudience?: (typeof AUDIENCES)[number];
  @ApiPropertyOptional({ enum: AUDIENCES }) @IsOptional() @IsIn(AUDIENCES) pushAudience?: (typeof AUDIENCES)[number];

  @ApiPropertyOptional({ type: [String], example: ['@allforcare.co.uk', 'tester@gmail.com'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(EMAIL_OR_DOMAIN, { each: true, message: 'Each allowed email must be an address or a domain starting with @' })
  allowedEmails?: string[];

  @ApiPropertyOptional({ type: [String], example: ['07700 900123'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(/^\+?[\d\s()-]{7,20}$/, { each: true, message: 'Each allowed number must be a phone number' })
  allowedPhones?: string[];

  @ApiPropertyOptional({ type: [String], description: '"<CHANNEL>:<kind>" entries switched off' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  disabledKinds?: string[];

  @ApiPropertyOptional({ nullable: true, example: 'testing@allforcare.co.uk' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @Matches(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/, { message: 'The held-emails inbox must be one email address' })
  heldEmailsTo?: string | null;
}

export class MessageDeliveryLogQueryDto {
  @ApiPropertyOptional({ enum: ['EMAIL', 'TEXT', 'WHATSAPP', 'PUSH'] })
  @IsOptional()
  @IsIn(['EMAIL', 'TEXT', 'WHATSAPP', 'PUSH'])
  channel?: string;

  @ApiPropertyOptional({ enum: ['SENT', 'HELD', 'REDIRECTED', 'FAILED'] })
  @IsOptional()
  @IsIn(['SENT', 'HELD', 'REDIRECTED', 'FAILED'])
  outcome?: string;

  @ApiPropertyOptional({ description: 'Part of a recipient, subject or type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class SendTestMessageDto {
  @ApiProperty({ enum: ['EMAIL', 'TEXT', 'PUSH'] })
  @IsIn(['EMAIL', 'TEXT', 'PUSH'])
  channel!: 'EMAIL' | 'TEXT' | 'PUSH';

  @ApiProperty({ description: 'Email address (EMAIL; for PUSH the carer whose email this is), or mobile number (TEXT)' })
  @IsString()
  @MaxLength(320)
  to!: string;
}
