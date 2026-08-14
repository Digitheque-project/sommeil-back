import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('Rapports & Statistiques')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @ApiOperation({
    summary: "Indicateurs d'activité du centre",
    description: 'Permission `stats:view`.',
  })
  @ApiQuery({ name: 'periode', required: false, description: '7j, 30j ou annee' })
  @ApiResponse({ status: 200, description: 'Indicateurs et séries de la période' })
  async getStats(@Query('periode') periode?: string) {
    return this.statsService.getStats(periode);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Exporter les statistiques',
    description: 'Permission `stats:export`.',
  })
  @ApiQuery({ name: 'periode', required: false, description: '7j, 30j ou annee' })
  async exportStats(@Query('periode') periode?: string) {
    return this.statsService.exportStats(periode);
  }
}
