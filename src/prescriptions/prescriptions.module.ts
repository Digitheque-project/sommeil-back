import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PlanningModule } from '../planning/planning.module';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';

@Module({
  imports: [HttpModule, PlanningModule],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
