import { Module } from '@nestjs/common';
import { PsgInterpretationsController } from './psg-interpretations.controller';
import { PsgInterpretationsService } from './psg-interpretations.service';

@Module({
  controllers: [PsgInterpretationsController],
  providers: [PsgInterpretationsService],
  exports: [PsgInterpretationsService],
})
export class PsgInterpretationsModule {}
