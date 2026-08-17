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
import {
  PsgInterpretationsService,
  type PsgInterpretationPayload,
} from './psg-interpretations.service';

@ApiTags('Interprétation PSG')
@Controller('psg-interpretations')
export class PsgInterpretationsController {
  constructor(private readonly psgInterpretationsService: PsgInterpretationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les interprétations de polysomnographie',
    description: 'Permission `psg:interpret_list`.',
  })
  @ApiQuery({ name: 'statut', required: false, description: 'BROUILLON ou VALIDE' })
  @ApiQuery({ name: 'psgId', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiResponse({ status: 200, description: 'Liste des interprétations' })
  async findAll(
    @Query('statut') statut?: string,
    @Query('psgId') psgId?: string,
    @Query('patientId') patientId?: string,
  ) {
    return this.psgInterpretationsService.findAll({ statut, psgId, patientId });
  }

  @Post()
  @ApiOperation({
    summary: 'Créer une interprétation pour un examen terminé',
    description: 'Permission `psg:interpret_create`.',
  })
  @ApiResponse({ status: 201, description: 'Interprétation créée' })
  async create(@Body() data: PsgInterpretationPayload) {
    return this.psgInterpretationsService.create(data);
  }

  @Get('by-psg/:psgId')
  @ApiOperation({
    summary: "Consulter l'interprétation d'un examen",
    description: 'Permission `psg:interpret_read`.',
  })
  async findByPsg(@Param('psgId') psgId: string) {
    return this.psgInterpretationsService.findByPsg(psgId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulter une interprétation',
    description: 'Permission `psg:interpret_read`.',
  })
  async findOne(@Param('id') id: string) {
    return this.psgInterpretationsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Modifier une interprétation non validée',
    description: 'Permission `psg:interpret_update`. Une interprétation validée renvoie 409.',
  })
  async update(@Param('id') id: string, @Body() data: PsgInterpretationPayload) {
    return this.psgInterpretationsService.update(id, data);
  }

  @Post(':id/validate')
  @ApiOperation({
    summary: 'Valider et signer une interprétation',
    description: 'Permission `psg:interpret_validate`. Verrouille le document.',
  })
  async validate(@Param('id') id: string, @Body() body: { validePar?: string }) {
    return this.psgInterpretationsService.validate(id, body?.validePar);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: "Charge utile d'export d'une interprétation",
    description: 'Permission `psg:interpret_export`.',
  })
  async exportOne(@Param('id') id: string) {
    return this.psgInterpretationsService.exportOne(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprimer une interprétation non validée',
    description: 'Permission `psg:interpret_delete`.',
  })
  async remove(@Param('id') id: string) {
    return this.psgInterpretationsService.remove(id);
  }
}
