import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  PlanningService,
  CreerRdvDto,
  ModifierRdvDto,
} from './planning.service';

@ApiTags('planning')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les rendez-vous du planning',
    description: 'Filtres optionnels : statut, dateDebut, dateFin, patientId.',
  })
  @ApiResponse({ status: 200, description: 'Liste des rendez-vous' })
  async lister(
    @Query('statut') statut?: string,
    @Query('dateDebut') dateDebut?: string,
    @Query('dateFin') dateFin?: string,
    @Query('patientId') patientId?: string,
  ) {
    return this.planningService.lister({
      statut,
      dateDebut,
      dateFin,
      patientId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtenir un rendez-vous par ID' })
  async obtenirParId(@Param('id') id: string) {
    return this.planningService.obtenirParId(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un rendez-vous' })
  @ApiResponse({ status: 201, description: 'Rendez-vous créé' })
  async creer(@Body() data: CreerRdvDto) {
    return this.planningService.creer(data);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un rendez-vous' })
  async modifier(@Param('id') id: string, @Body() data: ModifierRdvDto) {
    return this.planningService.modifier(id, data);
  }

  @Patch(':id/annuler')
  @ApiOperation({ summary: 'Annuler un rendez-vous' })
  async annuler(@Param('id') id: string) {
    return this.planningService.annuler(id);
  }

  @Patch(':id/realise')
  @ApiOperation({
    summary: 'Recevoir le patient : le RDV devient une consultation à traiter',
    description:
      "Marque le rendez-vous comme réalisé et ouvre (ou retrouve) la consultation locale correspondante. La réponse porte `consultation.id`, à utiliser pour ouvrir l'écran de traitement.",
  })
  @ApiResponse({ status: 200, description: 'Rendez-vous réalisé et consultation ouverte' })
  async marquerRealise(@Param('id') id: string) {
    return this.planningService.marquerRealise(id);
  }

  @Patch(':id/non-realise')
  @ApiOperation({ summary: 'Marquer un rendez-vous comme non réalisé' })
  async marquerNonRealise(@Param('id') id: string) {
    return this.planningService.marquerNonRealise(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un rendez-vous' })
  async supprimer(@Param('id') id: string) {
    return this.planningService.supprimer(id);
  }
}
