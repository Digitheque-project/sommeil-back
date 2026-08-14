import { Module } from '@nestjs/common';
import { ComptesRendusController } from './comptes-rendus.controller';
import { ComptesRendusService } from './comptes-rendus.service';

@Module({
  controllers: [ComptesRendusController],
  providers: [ComptesRendusService],
  exports: [ComptesRendusService],
})
export class ComptesRendusModule {}
