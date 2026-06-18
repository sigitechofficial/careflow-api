import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  uniqueConstraintErrors,
  uniqueConstraintMessage,
} from '../utils/prisma-unique-constraint.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const fallbackStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    const fallbackMessage = 'Unexpected error';

    const { status, body } = this.toResponse(exception, fallbackStatus, fallbackMessage);
    response.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    fallbackStatus: number,
    fallbackMessage: string,
  ): { status: number; body: unknown } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as Record<string, unknown> | string;

      if (typeof res === 'object' && res !== null && !Array.isArray(res)) {
        const message =
          typeof res.message === 'string'
            ? res.message
            : Array.isArray(res.message)
              ? 'Validation failed'
              : exception.message || fallbackMessage;
        const errors = Array.isArray(res.message) ? res.message : undefined;
        return {
          status,
          body: {
            success: false,
            message,
            errors,
            ...(Array.isArray(res.warnings) ? { warnings: res.warnings } : {}),
            ...(res.requiresConfirmation !== undefined
              ? { requiresConfirmation: res.requiresConfirmation }
              : {}),
          },
        };
      }

      const message =
        typeof res === 'string'
          ? res
          : exception.message || fallbackMessage;

      return {
        status,
        body: {
          success: false,
          message,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaKnownError(exception);
      return {
        status: mapped.status,
        body: {
          success: false,
          message: mapped.message,
          errors: mapped.errors,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(exception.message);
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          success: false,
          message: 'Invalid request data',
          errors: [exception.message],
        },
      };
    }

    const message =
      exception instanceof Error ? exception.message : fallbackMessage;
    this.logger.error(exception);

    return {
      status: fallbackStatus,
      body: {
        success: false,
        message: process.env.NODE_ENV === 'production' ? fallbackMessage : message,
      },
    };
  }

  private mapPrismaKnownError(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    errors?: unknown[];
  } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: uniqueConstraintMessage(e.meta),
          errors: uniqueConstraintErrors(e.meta),
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Related record not found (invalid reference)',
          errors: [{ code: e.code, field: (e.meta as { field_name?: string })?.field_name }],
        };
      case 'P2021':
        return {
          status: HttpStatus.FAILED_DEPENDENCY,
          message:
            'A required database table is missing. From careadmin-backend run: pnpm exec prisma migrate deploy (or prisma migrate dev in development), then restart the API.',
          errors: [{ code: e.code, meta: e.meta }],
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Database error',
          errors: [{ code: e.code }],
        };
    }
  }
}

