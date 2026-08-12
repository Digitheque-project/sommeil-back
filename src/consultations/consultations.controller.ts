import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConsultationsService } from './consultations.service';

@ApiTags('consultations')
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Obtenir toutes les consultations',
    description: 'Récupère la liste complète des consultations depuis le service consultation externe'
  })
  @ApiResponse({
    status: 200,
    description: 'Liste de toutes les consultations'
  })
  async getAll(
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
  ) {
    return this.consultationsService.getAllConsultations({
      date,
      dateFrom,
      dateTo,
      archived: archived === 'true',
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtenir une consultation par ID',
    description: 'Récupère les détails complets d\'une consultation spécifique'
  })
  @ApiResponse({
    status: 200,
    description: 'Détails de la consultation'
  })
  async getById(@Param('id') id: string) {
    return this.consultationsService.getConsultationById(+id);
  }

  @Post(':id/finalize')
  @ApiOperation({
    summary: 'Finaliser une consultation',
    description: 'Finalise une consultation en ajoutant l\'observation et les prescriptions'
  })
  @ApiResponse({
    status: 200,
    description: 'Consultation finalisée avec succès'
  })
  async finalizeConsultation(@Param('id') id: string, @Body() data: any) {
    return this.consultationsService.finalizeConsultation(+id, data);
  }

  @Post(':id/traiter')
  @ApiOperation({
    summary: 'Traiter une consultation',
    description: 'Actions disponibles : "ouvrir", "annuler", "terminer", "controle"'
  })
  async traiterConsultation(@Param('id') id: string, @Body() data: any) {
    return this.consultationsService.traiterConsultation(+id, data);
  }

  @Get('patient/:patientId/history')
  @ApiOperation({
    summary: 'Obtenir l\'historique des consultations d\'un patient'
  })
  async getPatientHistory(@Param('patientId') patientId: string) {
    return this.consultationsService.getPatientConsultationHistory(patientId);
  }
}
