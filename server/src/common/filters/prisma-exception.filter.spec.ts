import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should map P2025 to NotFoundException', () => {
    const error = new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
      code: 'P2025',
      clientVersion: '7.8.0',
    });

    expect(() => filter.catch(error, {} as never)).toThrow(NotFoundException);
  });

  it('should rethrow non-P2025 errors unchanged', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.8.0',
    });

    expect(() => filter.catch(error, {} as never)).toThrow(error);
  });
});
