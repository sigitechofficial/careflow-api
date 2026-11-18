import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetSignInAccessDto {
  @ApiPropertyOptional({ description: 'Office login (CareFlow website). true switches it on and emails a set-password link.' })
  @IsOptional()
  @IsBoolean()
  website?: boolean;

  @ApiPropertyOptional({ description: 'Care app access. true switches it on and emails a set-password link.' })
  @IsOptional()
  @IsBoolean()
  app?: boolean;

  @ApiPropertyOptional({
    minLength: 8,
    description:
      'Optional, only when switching access on: the office sets the password now instead of emailing a link. It works for both sign-ins; the welcome email never contains it. Only its hash is stored.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class SetStaffPasswordDto {
  @ApiProperty({ minLength: 8, description: 'New password for their office login and Care app (one password). Not emailed; only its hash is stored.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SendOfficeUserInviteDto {
  @ApiPropertyOptional({ description: 'The office set their password when adding them: the email says their manager will give it to them (no link).' })
  @IsOptional()
  @IsBoolean()
  passwordGiven?: boolean;
}
