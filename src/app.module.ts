import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConsultationsModule } from './consultations/consultations.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { ComptesRendusModule } from './comptes-rendus/comptes-rendus.module';
import { ArchivesModule } from './archives/archives.module';
import { PsgModule } from './psg/psg.module';
import { StatsModule } from './stats/stats.module';
import { ServicesModule } from './services/services.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConsultationsModule,
    PrescriptionsModule,
    ComptesRendusModule,
    ArchivesModule,
    PsgModule,
    StatsModule,
    ServicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
