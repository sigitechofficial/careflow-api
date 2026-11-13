import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Multipart fields arrive as strings: "true" / "false" → boolean, anything else → undefined.
 * Reads the raw field (`obj[key]`): the global pipe's implicit conversion has already turned
 * "false" into `true` (Boolean("false")) by the time `value` gets here.
 */
const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : undefined;
};
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** A public job application (careers page). */
export class ApplyForVacancyDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty()
  @Transform(trimmed)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(200)
  email!: string;

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MinLength(6, { message: 'Enter a phone number' })
  @MaxLength(40)
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiProperty({ description: 'Has the right to work in the UK' })
  @Transform(toBool)
  @IsBoolean({ message: 'Tell us if you have the right to work in the UK' })
  hasRightToWork!: boolean;

  @ApiPropertyOptional({ description: 'Has a full driving licence and can drive for work' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  drivesForWork?: boolean;

  @ApiPropertyOptional({ description: 'Why they want the job / anything to add' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(5000)
  coverLetter?: string;

  @ApiProperty({ description: 'Agrees to their data being used for this application' })
  @Transform(toBool)
  @Equals(true, { message: 'Please agree to us using your details for your application' })
  consent!: boolean;

  /** Honeypot: hidden from people, filled in by bots. Must stay empty. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}
