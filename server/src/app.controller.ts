import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller({ path: '/', version: ['1', '2'] })
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get()
  getRoot(): { message: string } {
    return { message: 'Welcome to the API!' };
  }

  @Get('health')
  async getHealth(): Promise<{ status: string; db_status: string }> {
    const dbConnectionStatus = await this.prisma.$queryRaw<{ version: string }[]>`SELECT VERSION()`;
    return { status: 'OK', db_status: dbConnectionStatus[0]?.version?.split(' ')[0] ?? 'unknown' };
  }
}
