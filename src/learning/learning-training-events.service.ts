import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LearningTrainingEventStatus } from '@prisma/client';
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

@Injectable()
export class LearningTrainingEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: LearningAssignmentsService,
  ) {}

  async list(query: LearningListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.learningTrainingEvent.findMany({
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningTrainingEvent.count(),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.learningTrainingEvent.findUnique({
      where: { id },
      include: { attendees: true },
    });
    if (!row) throw new NotFoundException('Training event not found');
    return row;
  }

  async create(userId: string, dto: CreateTrainingEventDto) {
    if (new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }
    return this.prisma.learningTrainingEvent.create({
      data: {
        ...dto,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        registrationDeadline: dto.registrationDeadline ? new Date(dto.registrationDeadline) : null,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateTrainingEventDto) {
    await this.getById(id);
    return this.prisma.learningTrainingEvent.update({
      where: { id },
      data: {
        ...dto,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        registrationDeadline: dto.registrationDeadline ? new Date(dto.registrationDeadline) : undefined,
        updatedById: userId,
      },
    });
  }

  async cancel(id: string, userId: string) {
    await this.getById(id);
    return this.prisma.learningTrainingEvent.update({
      where: { id },
      data: { status: LearningTrainingEventStatus.CANCELLED, updatedById: userId },
    });
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.learningTrainingEvent.delete({ where: { id } });
    return { id, deleted: true };
  }

  async addAttendee(eventId: string, dto: AddTrainingEventAttendeeDto) {
    await this.getById(eventId);
    await this.assignments.validateActiveEmployee(dto.employeeId);
    return this.prisma.learningTrainingEventAttendee.upsert({
      where: { trainingEventId_employeeId: { trainingEventId: eventId, employeeId: dto.employeeId } },
      create: {
        trainingEventId: eventId,
        employeeId: dto.employeeId,
        bookingStatus: dto.bookingStatus,
      },
      update: { bookingStatus: dto.bookingStatus },
    });
  }

  async updateAttendee(attendeeId: string, dto: UpdateTrainingEventAttendeeDto) {
    const attendee = await this.prisma.learningTrainingEventAttendee.findUnique({ where: { id: attendeeId } });
    if (!attendee) throw new NotFoundException('Attendee not found');

    const completedAt =
      dto.attendanceStatus === 'ATTENDED' || dto.attendanceStatus === 'PARTIALLY_ATTENDED'
        ? new Date()
        : attendee.completedAt;

    return this.prisma.learningTrainingEventAttendee.update({
      where: { id: attendeeId },
      data: {
        bookingStatus: dto.bookingStatus,
        attendanceStatus: dto.attendanceStatus,
        completedAt,
      },
    });
  }
}
