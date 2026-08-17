import { Module } from '@nestjs/common';
import { PsgController } from './psg.controller';
import { PsgService } from './psg.service';
import { ArchivesModule } from '../archives/archives.module';

@Module({
  imports: [ArchivesModule],
  controllers: [PsgController],
  providers: [PsgService],
  exports: [PsgService],
})
export class PsgModule {}
