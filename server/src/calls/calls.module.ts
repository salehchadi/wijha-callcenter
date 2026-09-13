import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsV2Controller } from './v2/calls-v2.controller';
import { CallsService } from './calls.service';
import { ClientsModule } from '@/clients/clients.module';

@Module({
  imports: [ClientsModule],
  controllers: [CallsController, CallsV2Controller],
  providers: [CallsService],
})
export class CallsModule {}
