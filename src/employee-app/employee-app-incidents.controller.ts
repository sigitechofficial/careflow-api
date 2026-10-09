import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppIncidentsService } from './employee-app-incidents.service';
import { EmployeeAppStandaloneIncidentDto } from './dto/employee-app-visit-writes.dto';

/** Incidents reported outside a visit (Me → Report an incident). */
@ApiTags('Employee App Incidents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/incidents')
export class EmployeeAppIncidentsController {
  constructor(private readonly incidents: EmployeeAppIncidentsService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Incident form catalog (types, severities, office-form lists)' })
  catalog() {
    return this.incidents.getCatalog();
  }

  @Post()
  @ApiOperation({
    summary: 'Report (or, before review, change) an incident that did not happen during a visit',
  })
  submit(@CurrentUser() user: RequestUser, @Body() dto: EmployeeAppStandaloneIncidentDto) {
    return this.incidents.submit(user.employeeId!, user.id, dto);
  }

  @Post(':clientEntryId/attachments')
  @ApiOperation({ summary: 'Attach a photo to an incident reported outside a visit' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        caption: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  addAttachment(
    @CurrentUser() user: RequestUser,
    @Param('clientEntryId') clientEntryId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('caption') caption?: string,
  ) {
    return this.incidents.addAttachment(user.employeeId!, clientEntryId, file, caption);
  }
}
