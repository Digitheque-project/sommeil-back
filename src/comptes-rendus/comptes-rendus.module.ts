import { Module } from '@nestjs/common';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { ComptesRendusController } from './comptes-rendus.controller';
import { ComptesRendusService } from './comptes-rendus.service';

@Module({
  imports: [PrescriptionsModule],
  controllers: [ComptesRendusController],
  providers: [ComptesRendusService],
  exports: [ComptesRendusService],
})
export class ComptesRendusModule {}
