import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Requests the user just sent (ids from a response's meta.hoursRequestIds). */
export class SentHoursRequestsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

/** "Approve now" for requests the manager just sent; the reason is optional. */
export class ApproveSentHoursRequestsDto extends SentHoursRequestsDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
