import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeAppAuthGuard } from '../employee-app/guards/employee-app-auth.guard';
import {
  CantAttendSessionDto,
  CarerLateReasonDto,
  CompleteContentDto,
  SubmitAssessmentAttemptDto,
} from './dto/learning.dto';
import { LearningCarerAppService } from './learning-carer-app.service';
import { LearningCertificatesService } from './learning-certificates.service';

/** Carer app → Learn. Only the signed-in carer's own training (docs/LEARNING_CARER_APP_API.md). */
@ApiTags('Employee App Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/learning')
export class LearningCarerAppController {
  constructor(
    private readonly service: LearningCarerAppService,
    private readonly certificateService: LearningCertificatesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My training: counts and assigned courses' })
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.employeeId!);
  }

  @Get('certificates')
  @ApiOperation({ summary: 'My certificates' })
  certificates(@CurrentUser() user: RequestUser) {
    return this.service.certificates(user.employeeId!);
  }

  @Get('certificates/:id/pdf-link')
  @ApiOperation({ summary: 'Short-lived link to one of my certificates as a PDF' })
  certificatePdfLink(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.certificateService.pdfLink(id, user.employeeId!);
  }

  @Get('assignments/:id')
  @ApiOperation({ summary: 'One of my courses: modules, lessons, quizzes, sessions' })
  detail(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(user.employeeId!, id);
  }

  @Post('assignments/:id/start')
  @ApiOperation({ summary: 'Start course tapped: records the start time (safe to retry)' })
  start(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.start(user.employeeId!, id);
  }

  @Post('assignments/:id/late-reason')
  @ApiOperation({ summary: 'Say why an overdue course is late (required before carrying on)' })
  lateReason(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CarerLateReasonDto,
  ) {
    return this.service.giveLateReason(user.employeeId!, id, dto.reasonCode, dto.note);
  }

  @Post('assignments/:id/lessons/:lessonId/complete')
  @ApiOperation({ summary: 'Mark a lesson as done (safe to retry)' })
  completeLesson(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: CompleteContentDto,
  ) {
    return this.service.completeLesson(
      user.employeeId!,
      id,
      lessonId,
      dto.timeSpentSeconds,
    );
  }

  @Get('assignments/:id/quizzes/:quizId')
  @ApiOperation({ summary: 'A quiz to take (no correct answers)' })
  quiz(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
  ) {
    return this.service.getQuiz(user.employeeId!, id, quizId);
  }

  @Post('assignments/:id/quizzes/:quizId/start')
  @ApiOperation({ summary: 'Start (or resume) a quiz attempt' })
  startQuiz(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
  ) {
    return this.service.startQuiz(user.employeeId!, id, quizId);
  }

  @Post('assignments/:id/quizzes/:quizId/submit')
  @ApiOperation({ summary: 'Submit my answers and get the result' })
  submitQuiz(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Body() dto: SubmitAssessmentAttemptDto,
  ) {
    return this.service.submitQuiz(user.employeeId!, id, quizId, dto);
  }

  @Post('sessions/:attendeeId/cant-attend')
  @ApiOperation({ summary: "Tell the office I can't attend a training session" })
  cantAttend(
    @CurrentUser() user: RequestUser,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @Body() dto: CantAttendSessionDto,
  ) {
    return this.service.cantAttend(user.employeeId!, attendeeId, dto.reason);
  }
}
