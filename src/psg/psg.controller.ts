import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PsgService } from './psg.service';

@ApiTags('Polysomnographie')
@Controller('psg')
export class PsgController {
  constructor(private readonly psgService: PsgService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les examens de polysomnographie',
    description: 'Permission `psg:list`.',
  })
  @ApiQuery({ name: 'statut', required: false, description: 'PLANIFIE, EN_COURS ou TERMINE' })
  @ApiResponse({ status: 200, description: 'Liste des examens' })
  async findAll(@Query('statut') statut?: string) {
    return this.psgService.findAll(statut);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulter un examen',
    description: 'Permission `psg:read`.',
  })
  async findOne(@Param('id') id: string) {
    return this.psgService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Modifier les paramètres d’un examen',
    description: 'Permission `psg:update`.',
  })
  async update(
    @Param('id') id: string,
    @Body() data: { rdvDate?: string; rdvHeure?: string; salle?: string; motif?: string },
  ) {
    return this.psgService.update(id, data);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: "Démarrer l'enregistrement",
    description: 'Permission `psg:start`. Passe le statut à EN_COURS.',
  })
  async start(@Param('id') id: string, @Body() body: { salle?: string }) {
    return this.psgService.start(id, body?.salle);
  }

  @Post(':id/stop')
  @ApiOperation({
    summary: "Arrêter l'enregistrement",
    description: 'Permission `psg:stop`. Passe le statut à TERMINE.',
  })
  async stop(@Param('id') id: string) {
    return this.psgService.stop(id);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: "Exporter les données de l'examen",
    description: 'Permission `psg:export_data`.',
  })
  async exportData(@Param('id') id: string) {
    return this.psgService.exportData(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprimer un examen',
    description: 'Permission `psg:delete`.',
  })
  async remove(@Param('id') id: string) {
    return this.psgService.remove(id);
  }
}
