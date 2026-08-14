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
import { ComptesRendusService, type CompteRenduPayload } from './comptes-rendus.service';

@ApiTags('Comptes rendus')
@Controller('comptes-rendus')
export class ComptesRendusController {
  constructor(private readonly comptesRendusService: ComptesRendusService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les comptes rendus',
    description: 'Permission `report:list`.',
  })
  @ApiQuery({ name: 'statut', required: false, description: 'BROUILLON ou VALIDE' })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiQuery({ name: 'consultationId', required: false })
  @ApiResponse({ status: 200, description: 'Liste des comptes rendus' })
  async findAll(
    @Query('statut') statut?: string,
    @Query('patientId') patientId?: string,
    @Query('consultationId') consultationId?: string,
  ) {
    return this.comptesRendusService.findAll({ statut, patientId, consultationId });
  }

  @Post()
  @ApiOperation({
    summary: 'Créer un compte rendu',
    description: 'Permission `report:create`.',
  })
  @ApiResponse({ status: 201, description: 'Compte rendu créé' })
  async create(@Body() data: CompteRenduPayload) {
    return this.comptesRendusService.create(data);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulter un compte rendu',
    description: 'Permission `report:read`.',
  })
  async findOne(@Param('id') id: string) {
    return this.comptesRendusService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Modifier un compte rendu non validé',
    description: 'Permission `report:update`. Un compte rendu validé renvoie 409.',
  })
  async update(@Param('id') id: string, @Body() data: CompteRenduPayload) {
    return this.comptesRendusService.update(id, data);
  }

  @Post(':id/validate')
  @ApiOperation({
    summary: 'Valider et signer un compte rendu',
    description: 'Permission `report:validate`. Verrouille le document.',
  })
  async validate(@Param('id') id: string, @Body() body: { validePar?: string }) {
    return this.comptesRendusService.validate(id, body?.validePar);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: "Charge utile d'export d'un compte rendu",
    description: 'Permission `report:export`.',
  })
  async exportOne(@Param('id') id: string) {
    return this.comptesRendusService.exportOne(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprimer un compte rendu non validé',
    description: 'Permission `report:delete`.',
  })
  async remove(@Param('id') id: string) {
    return this.comptesRendusService.remove(id);
  }
}
