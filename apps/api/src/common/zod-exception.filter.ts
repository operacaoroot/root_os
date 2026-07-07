import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    res.status(400).json({
      statusCode: 400,
      error: 'ValidationError',
      issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}
