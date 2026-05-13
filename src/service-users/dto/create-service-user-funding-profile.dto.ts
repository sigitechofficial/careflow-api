import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FundingBillingType, FundingFunderKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateServiceUserFundingProfileDto {
  @ApiProperty()
  @IsUUID()
  careServiceId!: string;

  @ApiProperty({ enum: FundingBillingType })
  @IsEnum(FundingBillingType)
  billingType!: FundingBillingType;

  @ApiProperty({ enum: FundingFunderKind })
  @IsEnum(FundingFunderKind)
  funder1Kind!: FundingFunderKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  funder1ContactId?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  funder1ExternalName?: string | null;

  @ApiProperty()
  @IsUUID()
  rateCardId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  invoiceMileage?: boolean;
}
