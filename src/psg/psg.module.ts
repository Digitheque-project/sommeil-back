import { Module } from '@nestjs/common';
import { PsgController } from './psg.controller';
import { PsgService } from './psg.service';

@Module({
  controllers: [PsgController],
  providers: [PsgService],
  exports: [PsgService],
})
export class PsgModule {}
