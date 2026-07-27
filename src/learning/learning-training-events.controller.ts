import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AddTrainingEventAttendeeDto,
  CreateTrainingEventDto,
  LearningListQueryDto,
  UpdateTrainingEventAttendeeDto,
  UpdateTrainingEventDto,
} from './dto/learning.dto';
import { LearningTrainingEventsService } from './learning-training-events.service';

@ApiTags('Learning — Training events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/training-events')
export class LearningTrainingEventsController {
  constructor(private readonly service: LearningTrainingEventsService) {}

  @Get()
  @Permissions('learning.training_events.read')
  @ApiOperation({ summary: 'List training events' })
  list(@Query() query: LearningListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('learning.training_events.read')
  @ApiOperation({ summary: 'Get training event' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Create training event' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTrainingEventDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Update training event' })
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateTrainingEventDto) {
    return this.service.update(id, user.id, dto);
  }

  @Post(':id/cancel')
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Cancel training event' })
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.cancel(id, user.id);
  }

  @Delete(':id')
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Delete training event' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/attendees')
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Add attendee to training event' })
  addAttendee(@Param('id') id: string, @Body() dto: AddTrainingEventAttendeeDto) {
    return this.service.addAttendee(id, dto);
  }

  @Patch('attendees/:attendeeId')
  @Permissions('learning.training_events.manage')
  @ApiOperation({ summary: 'Update training event attendee' })
  updateAttendee(@Param('attendeeId') attendeeId: string, @Body() dto: UpdateTrainingEventAttendeeDto) {
    return this.service.updateAttendee(attendeeId, dto);
  }
}
