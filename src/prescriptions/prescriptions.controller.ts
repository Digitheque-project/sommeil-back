import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
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
  ) {
    return this.prescriptionsService.getPatientPrescriptions(patientId, chuId);
  }

  @Get('polysomnographie')
  @ApiOperation({
    summary:
      'Récupérer toutes les prescriptions de polysomnographie reçues des services externes',
  })
  @ApiResponse({
    status: 200,
    description:
      'Liste des prescriptions de polysomnographie avec leur état de planification',
  })
  async getPolysomnographies() {
    return this.prescriptionsService.getPolysomnographiePrescriptions();
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
  ) {
    return this.prescriptionsService.updatePrescriptionStatus(
      id,
      body.statut,
      body.actionParId,
    );
  }
}
