import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConsultationsModule } from './consultations/consultations.module';

@Module({
  imports: [ConsultationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
