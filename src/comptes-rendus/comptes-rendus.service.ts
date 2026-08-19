import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CompteRenduPayload = {
  consultationId?: string;
  psgId?: string;
  titre?: string;
  contenu?: string;
  type?: string;
  patientId?: string;
  patientNom?: string;
};

@Injectable()
export class ComptesRendusService {
  private readonly logger = new Logger(ComptesRendusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Un compte rendu validé est verrouillé : plus aucune écriture n'est acceptée. */
  private assertModifiable(compteRendu: { statut: string }) {
    if (compteRendu.statut === 'VALIDE') {
      throw new ConflictException(
        'Ce compte rendu est validé et signé : il ne peut plus être modifié ni supprimé.',
      );
    }
  }

  async findAll(filters: {
    statut?: string;
    patientId?: string;
    consultationId?: string;
    psgId?: string;
  }) {
    const where: Record<string, any> = {};
    if (filters.statut) where.statut = filters.statut;
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.consultationId) where.consultationId = filters.consultationId;
    if (filters.psgId) where.psgId = filters.psgId;

    return this.prisma.compteRendu.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const compteRendu = await this.prisma.compteRendu.findUnique({ where: { id } });
    if (!compteRendu) throw new NotFoundException('Compte rendu non trouvé');
    return compteRendu;
  }

  async create(data: CompteRenduPayload) {
    if (!data.psgId && !data.consultationId) {
      throw new BadRequestException('psgId (ou consultationId) est requis');
    }
    if (!data.contenu?.trim()) {
      throw new BadRequestException('Le contenu du compte rendu est requis');
    }

    let patientId = data.patientId;
    let patientNom = data.patientNom;

    if (data.psgId && (!patientId || !patientNom)) {
      const exam = await this.prisma.polysomnographiePlanification.findUnique({
        where: { id: data.psgId },
      });
      if (!exam) throw new NotFoundException('Examen PSG non trouvé');
      patientId = patientId ?? exam.patientId;
      patientNom = patientNom ?? `${exam.patientPrenom} ${exam.patientNom}`.trim();
    }

    return this.prisma.compteRendu.create({
      data: {
        consultationId: data.consultationId,
        psgId: data.psgId,
        titre: data.titre?.trim() || 'Compte rendu',
        contenu: data.contenu,
        type: data.type ?? 'MEDICAL',
        patientId,
        patientNom,
      },
    });
  }

  async update(id: string, data: CompteRenduPayload) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    return this.prisma.compteRendu.update({
      where: { id },
      data: {
        ...(data.titre !== undefined ? { titre: data.titre } : {}),
        ...(data.contenu !== undefined ? { contenu: data.contenu } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
      },
    });
  }

  async validate(id: string, validePar?: string) {
    const existing = await this.findOne(id);
    if (existing.statut === 'VALIDE') return existing;
    if (!existing.contenu?.trim()) {
      throw new BadRequestException('Un compte rendu vide ne peut pas être validé.');
    }

    return this.prisma.compteRendu.update({
      where: { id },
      data: { statut: 'VALIDE', valideLe: new Date(), validePar: validePar ?? null },
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    await this.prisma.compteRendu.delete({ where: { id } });
    return { success: true, id };
  }

  /**
   * Charge utile d'export. Le rendu PDF est fait côté client (impression du
   * navigateur) : le backend fournit uniquement les données mises en forme.
   */
  async exportOne(id: string) {
    const compteRendu = await this.findOne(id);

    const consultation = compteRendu.consultationId
      ? await this.prisma.consultationLocale
          .findUnique({ where: { id: compteRendu.consultationId } })
          .catch(() => null)
      : null;

    const exam = compteRendu.psgId
      ? await this.prisma.polysomnographiePlanification
          .findUnique({ where: { id: compteRendu.psgId } })
          .catch(() => null)
      : null;

    return {
      id: compteRendu.id,
      titre: compteRendu.titre,
      contenu: compteRendu.contenu,
      type: compteRendu.type,
      statut: compteRendu.statut,
      valideLe: compteRendu.valideLe,
      validePar: compteRendu.validePar,
      genereLe: new Date().toISOString(),
      patient: {
        id: compteRendu.patientId ?? consultation?.patientId ?? exam?.patientId ?? null,
        nom:
          compteRendu.patientNom ??
          (consultation
            ? `${consultation.patientPrenom} ${consultation.patientNom}`.trim()
            : exam
              ? `${exam.patientPrenom} ${exam.patientNom}`.trim()
              : null),
        dossier: consultation?.patientDossier ?? null,
      },
      consultation: consultation
        ? {
            id: consultation.id,
            date: consultation.date,
            heure: consultation.heure,
            motif: consultation.motif,
          }
        : null,
      examen: exam
        ? {
            id: exam.id,
            rdvDate: exam.rdvDate,
            rdvHeure: exam.rdvHeure,
            motif: exam.motif,
            termineLe: exam.termineLe,
          }
        : null,
    };
  }
}
