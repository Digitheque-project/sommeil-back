import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CreateArchivePayload = {
  type: string;
  referenceId: string;
  titre: string;
  description?: string;
  donnees: any;
  archivedBy?: string;
};

@Injectable()
export class ArchivesService {
  private readonly logger = new Logger(ArchivesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: { type?: string; includeRestored?: boolean }) {
    return this.prisma.archive.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.includeRestored ? {} : { restored: false }),
      },
      orderBy: { archivedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const archive = await this.prisma.archive.findUnique({ where: { id } });
    if (!archive) throw new NotFoundException('Archive non trouvée');
    return archive;
  }

  async create(data: CreateArchivePayload) {
    if (!data?.type || !data?.referenceId || !data?.titre) {
      throw new BadRequestException('type, referenceId et titre sont requis');
    }

    return this.prisma.archive.create({
      data: {
        type: data.type,
        referenceId: data.referenceId,
        titre: data.titre,
        description: data.description,
        donnees: data.donnees ?? {},
        archivedBy: data.archivedBy,
      },
    });
  }

  /** Réactive un dossier archivé : il sort du registre sans être détruit. */
  async restore(id: string, restoredBy?: string) {
    const archive = await this.findOne(id);
    if (archive.restored) {
      throw new ConflictException('Ce dossier a déjà été restauré.');
    }

    const restoredArchive = await this.prisma.archive.update({
      where: { id },
      data: { restored: true, restoredAt: new Date(), restoredBy: restoredBy ?? null },
    });

    // Une consultation archivée redevient visible dans le fil de travail.
    if (archive.type === 'CONSULTATION') {
      await this.prisma.consultationLocale
        .update({ where: { id: archive.referenceId }, data: { archived: false } })
        .catch((error) =>
          this.logger.warn(
            `Archive ${id} restaurée, mais la consultation ${archive.referenceId} est introuvable: ${error}`,
          ),
        );
    }

    return { success: true, archive: restoredArchive };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.archive.delete({ where: { id } });
    return { success: true, id };
  }

  /** Charge utile d'export d'un dossier archivé (rendu fait côté client). */
  async exportOne(id: string) {
    const archive = await this.findOne(id);
    return {
      ...archive,
      genereLe: new Date().toISOString(),
    };
  }

  /** Export du registre complet, filtré comme la liste affichée. */
  async exportAll(filters: { type?: string; includeRestored?: boolean }) {
    const archives = await this.findAll(filters);
    return {
      genereLe: new Date().toISOString(),
      total: archives.length,
      archives,
    };
  }
}
