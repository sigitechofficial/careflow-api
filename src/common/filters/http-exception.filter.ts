import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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
      const res = exception.getResponse() as any;

      const message =
        typeof res?.message === 'string'
          ? res.message
          : Array.isArray(res?.message)
            ? 'Validation failed'
            : exception.message || fallbackMessage;

      const errors = Array.isArray(res?.message) ? res.message : undefined;

      return {
        status,
        body: {
          success: false,
          message,
          errors,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // https://www.prisma.io/docs/orm/reference/error-reference
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

    return {
      status: fallbackStatus,
      body: {
        success: false,
        message: fallbackMessage,
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
          message: 'Unique constraint failed',
          errors: [{ target: (e.meta as any)?.target }],
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
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

