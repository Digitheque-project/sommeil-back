import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PsgInterpretationPayload = {
  psgId?: string;
  titre?: string;
  contenu?: string;
};

@Injectable()
export class PsgInterpretationsService {
  private readonly logger = new Logger(PsgInterpretationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertModifiable(interpretation: { statut: string }) {
    if (interpretation.statut === 'VALIDE') {
      throw new ConflictException(
        'Cette interprétation est validée et signée : elle ne peut plus être modifiée ni supprimée.',
      );
    }
  }

  async findAll(filters: { statut?: string; psgId?: string; patientId?: string }) {
    const where: Record<string, any> = {};
    if (filters.statut) where.statut = filters.statut;
    if (filters.psgId) where.psgId = filters.psgId;
    if (filters.patientId) where.patientId = filters.patientId;

    return this.prisma.psgInterpretation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const interpretation = await this.prisma.psgInterpretation.findUnique({ where: { id } });
    if (!interpretation) throw new NotFoundException('Interprétation non trouvée');
    return interpretation;
  }

  async findByPsg(psgId: string) {
    return this.prisma.psgInterpretation.findUnique({ where: { psgId } });
  }

  async create(data: PsgInterpretationPayload) {
    if (!data.psgId) {
      throw new BadRequestException('psgId est requis');
    }
    if (!data.contenu?.trim()) {
      throw new BadRequestException("Le contenu de l'interprétation est requis");
    }

    const exam = await this.prisma.polysomnographiePlanification.findUnique({
      where: { id: data.psgId },
    });
    if (!exam) throw new NotFoundException('Examen de polysomnographie non trouvé');
    if (exam.statut !== 'TERMINE') {
      throw new ConflictException(
        "Cet examen doit être terminé avant de pouvoir être interprété.",
      );
    }

    const existing = await this.prisma.psgInterpretation.findUnique({
      where: { psgId: data.psgId },
    });
    if (existing) {
      throw new ConflictException('Une interprétation existe déjà pour cet examen.');
    }

    return this.prisma.psgInterpretation.create({
      data: {
        psgId: data.psgId,
        patientId: exam.patientId,
        patientNom: exam.patientNom,
        patientPrenom: exam.patientPrenom,
        titre: data.titre?.trim() || `Interprétation PSG — ${exam.patientPrenom} ${exam.patientNom}`,
        contenu: data.contenu,
      },
    });
  }

  async update(id: string, data: PsgInterpretationPayload) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    return this.prisma.psgInterpretation.update({
      where: { id },
      data: {
        ...(data.titre !== undefined ? { titre: data.titre } : {}),
        ...(data.contenu !== undefined ? { contenu: data.contenu } : {}),
      },
    });
  }

  async validate(id: string, validePar?: string) {
    const existing = await this.findOne(id);
    if (existing.statut === 'VALIDE') return existing;
    if (!existing.contenu?.trim()) {
      throw new BadRequestException('Une interprétation vide ne peut pas être validée.');
    }

    return this.prisma.psgInterpretation.update({
      where: { id },
      data: { statut: 'VALIDE', valideLe: new Date(), validePar: validePar ?? null },
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    await this.prisma.psgInterpretation.delete({ where: { id } });
    return { success: true, id };
  }

  /**
   * Charge utile d'export. Le rendu PDF est fait côté client (impression du
   * navigateur) : le backend fournit uniquement les données mises en forme.
   */
  async exportOne(id: string) {
    const interpretation = await this.findOne(id);
    const exam = await this.prisma.polysomnographiePlanification
      .findUnique({ where: { id: interpretation.psgId } })
      .catch(() => null);

    return {
      id: interpretation.id,
      titre: interpretation.titre,
      contenu: interpretation.contenu,
      statut: interpretation.statut,
      valideLe: interpretation.valideLe,
      validePar: interpretation.validePar,
      genereLe: new Date().toISOString(),
      patient: {
        id: interpretation.patientId,
        nom: `${interpretation.patientPrenom} ${interpretation.patientNom}`.trim(),
      },
      examen: exam
        ? {
            id: exam.id,
            rdvDate: exam.rdvDate,
            demarreLe: exam.demarreLe,
            termineLe: exam.termineLe,
            motif: exam.motif,
          }
        : null,
    };
  }
}
