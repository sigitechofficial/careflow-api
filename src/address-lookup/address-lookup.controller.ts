import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AddressLookupService } from './address-lookup.service';

/** Any signed-in office user filling in an address. */
@ApiTags('Address lookup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('address-lookup')
export class AddressLookupController {
  constructor(private readonly lookup: AddressLookupService) {}

  @Get('status')
  @ApiOperation({ summary: 'Which address lookups are set up' })
  status() {
    return { data: this.lookup.status() };
  }

  @Get('postcodes')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Postcodes that start with what was typed (postcodes.io)' })
  async postcodes(@Query('q') q: string) {
    return { data: await this.lookup.suggestPostcodes(q ?? '') };
  }

  @Get('addresses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Every address at a full UK postcode' })
  async addresses(@Query('postcode') postcode: string) {
    return { data: await this.lookup.addressesForPostcode(postcode ?? '') };
  }
}
