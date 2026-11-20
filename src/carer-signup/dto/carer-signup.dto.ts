import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Care app "Create an account": the carer's own sign-up, waiting for office approval. */
export class CarerSignupDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;

  @ApiProperty({ example: '+44 7700900123', description: 'Mobile number, digits with an optional leading +' })
  @IsString()
  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'Enter a valid mobile number' })
  mobile!: string;

  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password!: string;

  @ApiProperty({ description: 'The branch the carer works from (from GET /employee-app/auth/signup-branches)' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ example: '1990-01-31' }) @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) town?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) postcode?: string;

  @ApiPropertyOptional({ example: 'QQ123456C' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-Da-d]$/, { message: 'Enter a valid National Insurance number' })
  nationalInsuranceNo?: string;
}

export class CarerDeletionRequestDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

/** Office decision on a Care app sign-up. Approve can set the carer's job details at the same time. */
export class CarerSignupDecisionDto {
  @ApiProperty({ enum: ['approve', 'decline'] }) @IsIn(['approve', 'decline']) decision!: 'approve' | 'decline';
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() rbacLevelId?: string;
  @ApiPropertyOptional({ description: 'Contracted weekly hours; optional (the admin warns when left empty)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  contractedWeeklyHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CarerDeletionDecisionDto {
  @ApiProperty({ enum: ['approve', 'decline'] }) @IsIn(['approve', 'decline']) decision!: 'approve' | 'decline';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
