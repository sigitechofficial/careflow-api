import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LearningAssignmentStatus,
  LearningAttendanceStatus,
  LearningBookingStatus,
  LearningTrainingEventStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  AddTrainingEventAttendeeDto,
  CreateTrainingEventDto,
  LearningListQueryDto,
  UpdateTrainingEventAttendeeDto,
  UpdateTrainingEventDto,
} from './dto/learning.dto';
import { LearningAssignmentsService } from './learning-assignments.service';
import { LearningCompletionService } from './learning-completion.service';
import { courseNeedsSession } from './learning-completion.util';
import { LearningPushService } from './learning-push.service';

/** Assignments a carer can still be booked on a session for. */
const OPEN_ASSIGNMENT_STATUSES: LearningAssignmentStatus[] = [
  LearningAssignmentStatus.ASSIGNED,
  LearningAssignmentStatus.NOT_STARTED,
  LearningAssignmentStatus.IN_PROGRESS,
  LearningAssignmentStatus.AWAITING_ASSESSMENT,
  LearningAssignmentStatus.AWAITING_APPROVAL,
  LearningAssignmentStatus.OVERDUE,
];

@Injectable()
export class LearningTrainingEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: LearningAssignmentsService,
    private readonly completion: LearningCompletionService,
    private readonly push: LearningPushService,
  ) {}

  async list(query: LearningListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { location: { contains: search, mode: 'insensitive' as const } },
            {
              course: {
                title: { contains: search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.learningTrainingEvent.findMany({
        where,
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          course: { select: { id: true, title: true, code: true } },
          attendees: {
            select: { bookingStatus: true, attendanceStatus: true },
          },
        },
      }),
      this.prisma.learningTrainingEvent.count({ where }),
    ]);
    return {
      data: rows.map(({ attendees, ...r }) => ({
        ...r,
        bookedCount: attendees.filter((a) => a.bookingStatus !== 'CANCELLED')
          .length,
        attendedCount: attendees.filter((a) => a.attendanceStatus === 'ATTENDED')
          .length,
        cantAttendCount: attendees.filter((a) => a.bookingStatus === 'CANCELLED')
          .length,
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  private async findEvent(id: string) {
    const row = await this.prisma.learningTrainingEvent.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, title: true, code: true } },
        attendees: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Training event not found');
    return row;
  }

  private async names(employeeIds: string[]) {
    if (!employeeIds.length) return new Map<string, string>();
    const people = await this.prisma.employeePersonalDetail.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, firstName: true, lastName: true },
    });
    return new Map(
      people.map((p) => [
        p.employeeId,
        `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unnamed carer',
      ]),
    );
  }

  async getById(id: string) {
    const row = await this.findEvent(id);
    const nameOf = await this.names(row.attendees.map((a) => a.employeeId));
    const assignmentIds = row.attendees
      .map((a) => a.assignmentId)
      .filter((x): x is string => !!x);
    const assignments = assignmentIds.length
      ? await this.prisma.learningAssignment.findMany({
          where: { id: { in: assignmentIds } },
          select: { id: true, status: true, dueAt: true },
        })
      : [];
    const assignmentOf = new Map(assignments.map((a) => [a.id, a]));
    return {
      ...row,
      attendees: row.attendees.map((a) => ({
        ...a,
        employeeName: nameOf.get(a.employeeId) ?? 'Unknown',
        assignmentStatus: a.assignmentId
          ? (assignmentOf.get(a.assignmentId)?.status ?? null)
          : null,
        assignmentDueAt: a.assignmentId
          ? (assignmentOf.get(a.assignmentId)?.dueAt ?? null)
          : null,
      })),
    };
  }

  /** Carers with this course assigned (still open) who are not on this session yet. */
  async eligibleAttendees(id: string) {
    const event = await this.findEvent(id);
    if (!event.courseId) return [];
    const onEvent = new Set(event.attendees.map((a) => a.employeeId));
    const rows = await this.prisma.learningAssignment.findMany({
      where: {
        courseId: event.courseId,
        employeeId: { not: null },
        status: { in: OPEN_ASSIGNMENT_STATUSES },
      },
      select: {
        id: true,
        employeeId: true,
        status: true,
        dueAt: true,
        sessionAttendees: {
          where: {
            bookingStatus: { not: 'CANCELLED' },
            trainingEvent: {
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              endAt: { gte: new Date() },
            },
          },
          select: { trainingEventId: true },
        },
      },
      orderBy: { dueAt: 'asc' },
    });
    const free = rows.filter((r) => !onEvent.has(r.employeeId!));
    const nameOf = await this.names(free.map((r) => r.employeeId!));
    return free.map((r) => ({
      assignmentId: r.id,
      employeeId: r.employeeId!,
      employeeName: nameOf.get(r.employeeId!) ?? 'Unknown',
      assignmentStatus: r.status,
      dueAt: r.dueAt,
      bookedOnOtherSession: r.sessionAttendees.length > 0,
    }));
  }

  private async assertSessionCourse(courseId: string | undefined | null) {
    if (!courseId) {
      throw new BadRequestException('Choose the course this session is for');
    }
    const course = await this.prisma.learningCourse.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { courseType: true, deliveryMethod: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (!courseNeedsSession(course.courseType, course.deliveryMethod)) {
      throw new BadRequestException(
        'Sessions are for training courses delivered face to face, virtually or blended',
      );
    }
  }

  async create(userId: string, dto: CreateTrainingEventDto) {
    if (new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('The end must be after the start');
    }
    await this.assertSessionCourse(dto.courseId);
    return this.prisma.learningTrainingEvent.create({
      data: {
        ...dto,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        registrationDeadline: dto.registrationDeadline ? new Date(dto.registrationDeadline) : null,
        // Created from the admin with a date: carers see it straight away (13 Nov 2026).
        status: LearningTrainingEventStatus.SCHEDULED,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateTrainingEventDto) {
    const event = await this.findEvent(id);
    const startAt = dto.startAt ? new Date(dto.startAt) : event.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : event.endAt;
    if (endAt <= startAt) {
      throw new BadRequestException('The end must be after the start');
    }
    if (dto.courseId !== undefined && dto.courseId !== event.courseId) {
      if (event.attendees.length) {
        throw new BadRequestException(
          'Remove the carers before changing the course of this session',
        );
      }
      await this.assertSessionCourse(dto.courseId);
    }
    return this.prisma.learningTrainingEvent.update({
      where: { id },
      data: {
        ...dto,
        startAt: dto.startAt ? startAt : undefined,
        endAt: dto.endAt ? endAt : undefined,
        registrationDeadline: dto.registrationDeadline ? new Date(dto.registrationDeadline) : undefined,
        updatedById: userId,
      },
    });
  }

  async cancel(id: string, userId: string) {
    const event = await this.findEvent(id);
    if (event.status === LearningTrainingEventStatus.CANCELLED) return event;
    const updated = await this.prisma.learningTrainingEvent.update({
      where: { id },
      data: { status: LearningTrainingEventStatus.CANCELLED, updatedById: userId },
    });
    // Tell the booked carers; they stay on the list so the office can see who to re-book.
    for (const a of event.attendees) {
      if (a.bookingStatus === 'CANCELLED' || !a.assignmentId) continue;
      await this.push.sessionCancelled({
        employeeId: a.employeeId,
        assignmentId: a.assignmentId,
        courseTitle: event.course?.title ?? event.title,
        startAt: event.startAt,
      });
    }
    return updated;
  }

  async remove(id: string) {
    const event = await this.findEvent(id);
    if (event.attendees.some((a) => a.attendanceStatus === 'ATTENDED')) {
      throw new BadRequestException(
        'Carers attended this session, so it cannot be deleted. Cancel it instead.',
      );
    }
    await this.prisma.learningTrainingEvent.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Book a carer who has this course assigned onto the session. */
  async addAttendee(eventId: string, dto: AddTrainingEventAttendeeDto) {
    const event = await this.findEvent(eventId);
    if (
      event.status === LearningTrainingEventStatus.CANCELLED ||
      event.status === LearningTrainingEventStatus.COMPLETED
    ) {
      throw new BadRequestException('This session is closed');
    }
    if (!event.courseId) {
      throw new BadRequestException('Choose the course this session is for first');
    }
    await this.assignments.validateActiveEmployee(dto.employeeId);
    const assignment = await this.prisma.learningAssignment.findFirst({
      where: {
        employeeId: dto.employeeId,
        courseId: event.courseId,
        status: { in: OPEN_ASSIGNMENT_STATUSES },
      },
      orderBy: { assignedAt: 'desc' },
      select: { id: true },
    });
    if (!assignment) {
      throw new BadRequestException(
        'This carer does not have this course assigned. Assign the course first.',
      );
    }
    const existing = event.attendees.find((a) => a.employeeId === dto.employeeId);
    const bookingStatus = dto.bookingStatus ?? LearningBookingStatus.BOOKED;
    if (
      bookingStatus === LearningBookingStatus.BOOKED &&
      event.capacity != null &&
      (!existing || existing.bookingStatus !== 'BOOKED')
    ) {
      const booked = event.attendees.filter((a) => a.bookingStatus === 'BOOKED').length;
      if (booked >= event.capacity) {
        throw new BadRequestException(`This session is full (${event.capacity} places)`);
      }
    }
    const attendee = await this.prisma.learningTrainingEventAttendee.upsert({
      where: { trainingEventId_employeeId: { trainingEventId: eventId, employeeId: dto.employeeId } },
      create: {
        trainingEventId: eventId,
        employeeId: dto.employeeId,
        assignmentId: assignment.id,
        bookingStatus,
        attendanceStatus: LearningAttendanceStatus.BOOKED,
      },
      // Re-booking clears an earlier "Can't attend".
      update: {
        assignmentId: assignment.id,
        bookingStatus,
        attendanceStatus: LearningAttendanceStatus.BOOKED,
        cantAttendReason: null,
        cantAttendAt: null,
      },
    });
    if (bookingStatus === LearningBookingStatus.BOOKED) {
      await this.push.sessionBooked({
        employeeId: dto.employeeId,
        assignmentId: assignment.id,
        courseTitle: event.course?.title ?? event.title,
        startAt: event.startAt,
      });
    }
    return attendee;
  }

  async removeAttendee(attendeeId: string) {
    const attendee = await this.prisma.learningTrainingEventAttendee.findUnique({
      where: { id: attendeeId },
    });
    if (!attendee) throw new NotFoundException('Attendee not found');
    if (attendee.attendanceStatus === 'ATTENDED') {
      throw new BadRequestException('This carer attended; their attendance cannot be removed');
    }
    await this.prisma.learningTrainingEventAttendee.delete({ where: { id: attendeeId } });
    return { id: attendeeId, deleted: true };
  }

  async updateAttendee(attendeeId: string, dto: UpdateTrainingEventAttendeeDto) {
    const attendee = await this.prisma.learningTrainingEventAttendee.findUnique({
      where: { id: attendeeId },
      include: { trainingEvent: { select: { startAt: true } } },
    });
    if (!attendee) throw new NotFoundException('Attendee not found');

    const marksAttendance =
      dto.attendanceStatus === 'ATTENDED' ||
      dto.attendanceStatus === 'PARTIALLY_ATTENDED' ||
      dto.attendanceStatus === 'ABSENT';
    if (marksAttendance && attendee.trainingEvent.startAt.getTime() > Date.now()) {
      throw new BadRequestException('Attendance can be marked once the session has started');
    }

    const completedAt =
      dto.attendanceStatus === 'ATTENDED' || dto.attendanceStatus === 'PARTIALLY_ATTENDED'
        ? new Date()
        : attendee.completedAt;

    const updated = await this.prisma.learningTrainingEventAttendee.update({
      where: { id: attendeeId },
      data: {
        bookingStatus: dto.bookingStatus,
        attendanceStatus: dto.attendanceStatus,
        completedAt,
      },
    });

    // Attended finishes the classroom part; the course completes when nothing else is left.
    if (dto.attendanceStatus && attendee.assignmentId) {
      const assignment = await this.prisma.learningAssignment.findUnique({
        where: { id: attendee.assignmentId },
        select: { status: true, progress: { select: { id: true } } },
      });
      if (
        assignment?.progress &&
        OPEN_ASSIGNMENT_STATUSES.includes(assignment.status)
      ) {
        await this.completion.refreshProgress(attendee.assignmentId);
      }
    }
    return updated;
  }
}
