import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertFlashMessageDto {
  @ApiProperty({
    example: 'Call daughter before visit.',
    maxLength: 150,
    description: 'Short temporary alert shown on the service user profile',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  message!: string;

  @ApiProperty({
    example: '2026-05-15',
    description: 'Last calendar day the message should display (UTC, inclusive)',
  })
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'displayUntil must be YYYY-MM-DD' })
  displayUntil!: string;
}
