import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { serviceUserPhotoUploadOptions } from '../service-user-photos/photo-upload.config';
import { PortalAuthGuard } from './guards/portal-auth.guard';
import { ServiceUserPortalService } from './service-user-portal.service';
import { PatchPortalAboutMeDto, PatchPortalProfileDto, CreatePortalContactDto } from './dto/service-user-portal.dto';

@ApiTags('Service User Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PortalAuthGuard)
@Controller('portal')
export class ServiceUserPortalController {
  constructor(private readonly portalService: ServiceUserPortalService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Portal dashboard aggregate' })
  dashboard(@CurrentUser() user: RequestUser) {
    return this.portalService.getDashboard(user.serviceUserId!);
  }

  @Get('lookups')
  @ApiOperation({ summary: 'Lookup lists for self-service profile editing' })
  lookups() {
    return this.portalService.getLookups();
  }

  @Get('profile')
  @ApiOperation({ summary: 'Full portal profile (read + self-service fields)' })
  profile(@CurrentUser() user: RequestUser) {
    return this.portalService.getProfile(user.serviceUserId!);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Self-service profile update (whitelisted fields)' })
  patchProfile(@CurrentUser() user: RequestUser, @Body() dto: PatchPortalProfileDto) {
    return this.portalService.patchProfile(user.serviceUserId!, dto);
  }

  @Get('about-me')
  @ApiOperation({ summary: 'About Me blob' })
  aboutMe(@CurrentUser() user: RequestUser) {
    return this.portalService.getAboutMe(user.serviceUserId!);
  }

  @Patch('about-me')
  @ApiOperation({ summary: 'Save About Me blob' })
  patchAboutMe(@CurrentUser() user: RequestUser, @Body() dto: PatchPortalAboutMeDto) {
    return this.portalService.patchAboutMe(user.serviceUserId!, dto);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Contacts on care record' })
  contacts(@CurrentUser() user: RequestUser) {
    return this.portalService.getContacts(user.serviceUserId!);
  }

  @Post('contacts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a contact to your care record' })
  createContact(@CurrentUser() user: RequestUser, @Body() dto: CreatePortalContactDto) {
    return this.portalService.createContact(user.serviceUserId!, dto);
  }

  @Get('allergies')
  @ApiOperation({ summary: 'Read-only allergies summary' })
  allergies(@CurrentUser() user: RequestUser) {
    return this.portalService.getAllergies(user.serviceUserId!);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Read-only upcoming calendar events' })
  calendar(@CurrentUser() user: RequestUser) {
    return this.portalService.getCalendar(user.serviceUserId!);
  }

  @Get('visit-plans')
  @ApiOperation({ summary: 'Read-only visit plans and scheduled visit slots' })
  visitPlans(@CurrentUser() user: RequestUser) {
    return this.portalService.getVisitPlans(user.serviceUserId!);
  }

  @Get('completed-visits')
  @ApiOperation({ summary: 'Completed care visits' })
  completedVisits(@CurrentUser() user: RequestUser) {
    return this.portalService.getCompletedVisits(user.serviceUserId!);
  }

  @Post('photos')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a photo to your care record' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        setAsProfile: { type: 'boolean', description: 'Use as profile photo' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', serviceUserPhotoUploadOptions))
  uploadPhoto(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { setAsProfile?: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const setAsProfile = body.setAsProfile === 'true' || body.setAsProfile === '1';
    return this.portalService.uploadPhoto(
      user.serviceUserId!,
      file,
      setAsProfile,
      getRequestAuditMeta(req),
    );
  }
}
