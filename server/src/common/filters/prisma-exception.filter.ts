import { Catch, ExceptionFilter, ArgumentsHost, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, _host: ArgumentsHost): void {
    if (exception.code === 'P2025') {
      throw new NotFoundException('Resource not found');
    }
    throw exception;
  }
}
