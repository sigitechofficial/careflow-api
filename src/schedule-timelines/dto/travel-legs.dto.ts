import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsLatitude, IsLongitude, ValidateNested } from 'class-validator';

/** Most journeys one request may ask for. */
export const MAX_TRAVEL_LEGS = 200;

export class TravelPointDto {
  @ApiProperty({ example: 51.4826 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: -0.0077 })
  @IsLongitude()
  lng!: number;
}

export class TravelLegPairDto {
  @ApiProperty({ type: TravelPointDto })
  @ValidateNested()
  @Type(() => TravelPointDto)
  from!: TravelPointDto;

  @ApiProperty({ type: TravelPointDto })
  @ValidateNested()
  @Type(() => TravelPointDto)
  to!: TravelPointDto;
}

export class TravelLegsDto {
  @ApiProperty({ type: [TravelLegPairDto], maxItems: MAX_TRAVEL_LEGS })
  @IsArray()
  @ArrayMaxSize(MAX_TRAVEL_LEGS)
  @ValidateNested({ each: true })
  @Type(() => TravelLegPairDto)
  pairs!: TravelLegPairDto[];
}
