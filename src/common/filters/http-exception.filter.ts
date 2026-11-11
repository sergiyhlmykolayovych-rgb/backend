import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Клієнт отримує лише загальний текст, тому справжню причину 5xx лишаємо в логах сервера.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} failed with ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    let message: string | string[] = 'Internal server error';

    if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
      const exceptionResponse =
        exception instanceof HttpException ? exception.getResponse() : null;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const exceptionMessage = exceptionResponse.message;

        if (Array.isArray(exceptionMessage)) {
          message = exceptionMessage;
        } else if (typeof exceptionMessage === 'string') {
          message = exceptionMessage;
        }
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
