import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CarerMessageAudience } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CARER_MESSAGE_TITLE_MAX = 65;
export const CARER_MESSAGE_BODY_MAX = 240;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Who receives the message. Used by both preview and send. */
export class CarerMessageAudienceDto {
  @ApiProperty({ enum: CarerMessageAudience })
  @IsEnum(CarerMessageAudience)
  audience!: CarerMessageAudience;

  @ApiPropertyOptional({ type: [String], description: 'Branches (locations) when audience is BRANCHES' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  locationIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Employees when audience is EMPLOYEES' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  employeeIds?: string[];
}

export class SendCarerMessageDto extends CarerMessageAudienceDto {
  @ApiProperty({ maxLength: CARER_MESSAGE_TITLE_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(CARER_MESSAGE_TITLE_MAX)
  title!: string;

  @ApiProperty({ maxLength: CARER_MESSAGE_BODY_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(CARER_MESSAGE_BODY_MAX)
  body!: string;
}
