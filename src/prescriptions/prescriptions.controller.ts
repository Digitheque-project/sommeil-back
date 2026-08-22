import { Controller, Get, Post, Put, Delete, Param, Body, Query, Headers } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';

@ApiTags('Prescriptions')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Get('patient/:patientId')
  @ApiOperation({ summary: "Récupérer les prescriptions d'un patient" })
  @ApiParam({ name: 'patientId', description: 'ID du patient' })
  @ApiQuery({ name: 'chuId', required: false, description: 'Filtrer par CHU' })
  @ApiResponse({
    status: 200,
    description: 'Liste des prescriptions du patient',
  })
  async getPatientPrescriptions(
    @Param('patientId') patientId: string,
    @Query('chuId') chuId?: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.prescriptionsService.getPatientPrescriptions(
      patientId,
      chuId,
      authorization,
    );
  }

  @Get('polysomnographie')
  @ApiOperation({
    summary:
      'Prescriptions de polysomnographie adressées au Centre de Sommeil',
    description:
      "Relaie le service prescriptions en filtrant sur le CHU (`CHU_ID`) et sur le " +
      "service destinataire. L'identifiant du service est résolu depuis l'annuaire " +
      '(`GET /services?chuId=`) ou fixé par `SLEEP_SERVICE_ID`. Le jeton porteur de ' +
      "l'appelant est relayé : sans lui, le service prescriptions répond 401.",
  })
  @ApiResponse({
    status: 200,
    description:
      'Liste des prescriptions de polysomnographie avec leur état de planification',
  })
  async getPolysomnographies(
    @Headers('authorization') authorization?: string,
  ) {
    return this.prescriptionsService.getPolysomnographiePrescriptions(
      authorization,
    );
  }

  @Post('polysomnographie/:id/schedule')
  @ApiOperation({ summary: 'Planifier un rendez-vous de polysomnographie' })
  @ApiParam({
    name: 'id',
    description: 'ID de la prescription polysomnographie',
  })
  @ApiResponse({ status: 200, description: 'Rendez-vous planifié avec succès' })
  async schedulePolysomnographie(
    @Param('id') id: string,
    @Body() body: { rdvDate: string; rdvHeure?: string },
  ) {
    return this.prescriptionsService.schedulePolysomnographie(id, body);
  }

  @Put(':id/statut')
  @ApiOperation({ summary: "Mettre à jour le statut d'une prescription" })
  @ApiParam({ name: 'id', description: 'ID de la prescription' })
  @ApiResponse({ status: 200, description: 'Statut mis à jour avec succès' })
  async updatePrescriptionStatus(
    @Param('id') id: string,
    @Body() body: { statut: string; actionParId?: string },
    @Headers('authorization') authorization?: string,
  ) {
    return this.prescriptionsService.updatePrescriptionStatus(
      id,
      body.statut,
      body.actionParId,
      authorization,
    );
  }

  @Get('planifications/all')
  @ApiOperation({ summary: 'Récupérer toutes les planifications de polysomnographie' })
  @ApiResponse({ status: 200, description: 'Liste des planifications' })
  async getAllPlanifications() {
    return this.prescriptionsService.getAllPlanifications();
  }

  @Get('planifications/:id')
  @ApiOperation({ summary: 'Récupérer une planification par ID' })
  @ApiParam({ name: 'id', description: 'ID de la planification' })
  @ApiResponse({ status: 200, description: 'Détails de la planification' })
  async getPlanificationById(@Param('id') id: string) {
    return this.prescriptionsService.getPlanificationById(id);
  }

  @Delete('planifications/:id')
  @ApiOperation({ summary: 'Supprimer une planification' })
  @ApiParam({ name: 'id', description: 'ID de la planification' })
  @ApiResponse({ status: 200, description: 'Planification supprimée avec succès' })
  async deletePlanification(@Param('id') id: string) {
    return this.prescriptionsService.deletePlanification(id);
  }

  @Post('archives')
  @ApiOperation({ summary: 'Créer un archive' })
  @ApiResponse({ status: 201, description: 'Archive créée avec succès' })
  async createArchive(@Body() data: { type: string; referenceId: string; titre: string; description?: string; donnees: any; archivedBy?: string }) {
    return this.prescriptionsService.createArchive(data);
  }

  @Get('archives')
  @ApiOperation({ summary: 'Récupérer les archives' })
  @ApiQuery({ name: 'type', required: false, description: 'Filtrer par type' })
  @ApiResponse({ status: 200, description: 'Liste des archives' })
  async getArchives(@Query('type') type?: string) {
    return this.prescriptionsService.getArchives(type);
  }
}
