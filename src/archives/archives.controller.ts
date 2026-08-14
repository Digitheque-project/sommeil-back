import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArchivesService, type CreateArchivePayload } from './archives.service';

@ApiTags('Archives')
@Controller('archives')
export class ArchivesController {
  constructor(private readonly archivesService: ArchivesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister les dossiers archivés',
    description: 'Permission `archive:list`.',
  })
  @ApiQuery({ name: 'type', required: false, description: 'CONSULTATION, PRESCRIPTION, ...' })
  @ApiQuery({ name: 'includeRestored', required: false, description: 'Inclure les dossiers restaurés' })
  @ApiResponse({ status: 200, description: 'Liste des archives' })
  async findAll(
    @Query('type') type?: string,
    @Query('includeRestored') includeRestored?: string,
  ) {
    return this.archivesService.findAll({
      type,
      includeRestored: includeRestored === 'true',
    });
  }

  @Post()
  @ApiOperation({ summary: 'Archiver un dossier' })
  @ApiResponse({ status: 201, description: 'Archive créée' })
  async create(@Body() data: CreateArchivePayload) {
    return this.archivesService.create(data);
  }

  // Route littérale déclarée avant `:id`.
  @Get('export')
  @ApiOperation({
    summary: "Exporter le registre des archives",
    description: 'Permission `archive:export`.',
  })
  async exportAll(
    @Query('type') type?: string,
    @Query('includeRestored') includeRestored?: string,
  ) {
    return this.archivesService.exportAll({
      type,
      includeRestored: includeRestored === 'true',
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulter une archive',
    description: 'Permission `archive:read`.',
  })
  async findOne(@Param('id') id: string) {
    return this.archivesService.findOne(id);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: 'Exporter un dossier archivé',
    description: 'Permission `archive:export`.',
  })
  async exportOne(@Param('id') id: string) {
    return this.archivesService.exportOne(id);
  }

  @Post(':id/restore')
  @ApiOperation({
    summary: 'Restaurer un dossier archivé',
    description: 'Permission `archive:restore`.',
  })
  async restore(@Param('id') id: string, @Body() body: { restoredBy?: string }) {
    return this.archivesService.restore(id, body?.restoredBy);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprimer définitivement une archive',
    description: 'Permission `archive:delete`.',
  })
  async remove(@Param('id') id: string) {
    return this.archivesService.remove(id);
  }
}
