import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import {
  EnquiryFundingType,
  EnquiryKind,
  EnquiryReceivedVia,
  EnquirySource,
  EnquiryType,
  EnquiryUrgency,
} from '@prisma/client';

export class CreateEnquiryDto {
  @ApiPropertyOptional({ enum: EnquiryKind, description: 'ENQUIRY (person / family) or REFERRAL (a professional). Default ENQUIRY.' })
  @IsOptional()
  @IsEnum(EnquiryKind)
  kind?: EnquiryKind;

  @ApiPropertyOptional({ description: 'Referral only: council, trust, hospital ward, GP practice…' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referringOrganisation?: string;

  @ApiPropertyOptional({ description: "Referral only: the referrer's role (social worker, discharge nurse…)." })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referrerRole?: string;

  @ApiPropertyOptional({ description: "Referral only: the referrer's reference (e.g. council case number)." })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  referralReference?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Referral only: the date on the referral.' })
  @IsOptional()
  @IsString()
  referralDate?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  lastName!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactRelationship?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ enum: EnquirySource })
  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  @ApiPropertyOptional({ enum: EnquiryType })
  @IsOptional()
  @IsEnum(EnquiryType)
  enquiryType?: EnquiryType;

  @ApiPropertyOptional({ enum: EnquiryUrgency })
  @IsOptional()
  @IsEnum(EnquiryUrgency)
  urgency?: EnquiryUrgency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  needs?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Care plans the person is likely to need (published care plan forms).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  carePlanFormIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Owning employee.' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ enum: EnquiryReceivedVia, description: 'How the enquiry reached us.' })
  @IsOptional()
  @IsEnum(EnquiryReceivedVia)
  receivedVia?: EnquiryReceivedVia;

  @ApiPropertyOptional({ format: 'date-time', description: 'When the referrer sent the enquiry.' })
  @IsOptional()
  @IsString()
  sentAt?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'When the office received the enquiry.' })
  @IsOptional()
  @IsString()
  receivedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;

  @ApiPropertyOptional({ description: 'Map position of the address (from Google Places). Null clears it.' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ description: 'Map position of the address (from Google Places). Null clears it.' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({ enum: EnquiryFundingType, deprecated: true, description: 'Use fundingTypeId.' })
  @IsOptional()
  @IsEnum(EnquiryFundingType)
  fundingType?: EnquiryFundingType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Funding type from the shared funding-type lookup.' })
  @IsOptional()
  @IsUUID()
  fundingTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  funderName?: string;

  @ApiPropertyOptional({ description: 'Requested care hours per week.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(168)
  hoursPerWeek?: number;

  @ApiPropertyOptional({ description: 'Requested visits per day.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  visitsPerDay?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'When care should start.' })
  @IsOptional()
  @IsString()
  requestedStartDate?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Next follow-up due.' })
  @IsOptional()
  @IsString()
  nextFollowUpAt?: string;

  @ApiPropertyOptional({ description: 'What needs doing at the next follow-up.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nextAction?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Branch (Location) the enquiry belongs to.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'When the assessment is booked.' })
  @IsOptional()
  @IsString()
  assessmentAt?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Office user carrying out the assessment.' })
  @IsOptional()
  @IsUUID()
  assessorId?: string;

  @ApiPropertyOptional({ description: 'Where the assessment takes place (home, hospital, …).' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assessmentLocation?: string;

  @ApiPropertyOptional({ description: 'Quoted price per week (£).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quoteWeeklyAmount?: number;

  @ApiPropertyOptional({ description: 'Quoted hourly rate (£).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quoteHourlyRate?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'When the quote was sent.' })
  @IsOptional()
  @IsString()
  quoteSentAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quoteNotes?: string;
}
