import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A new office user. Without a password they choose their own from the welcome email (POST /users/:id/send-invite);
 * with one, the office gives it to them (the email never contains it). Only its hash is stored.
 */
export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'Optional: set the password now instead of emailing a link. Never emailed; only its hash is stored.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
