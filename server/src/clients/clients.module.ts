import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsV2Controller } from './v2/clients-v2.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController, ClientsV2Controller],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
