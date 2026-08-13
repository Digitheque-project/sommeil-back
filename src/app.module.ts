import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConsultationsModule } from './consultations/consultations.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';

@Module({
  imports: [ConsultationsModule, PrescriptionsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
