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
  iah?: number | null;
  indexDesaturation?: number | null;
  spo2Moyenne?: number | null;
  spo2Min?: number | null;
  efficaciteSommeil?: number | null;
  latenceEndormissement?: number | null;
  latenceRem?: number | null;
  tempsSommeilTotal?: number | null;
  severite?: string | null;
  conclusion?: string;
  recommandations?: string | null;
};

const NUMERIC_FIELDS = [
  'iah',
  'indexDesaturation',
  'spo2Moyenne',
  'spo2Min',
  'efficaciteSommeil',
  'latenceEndormissement',
  'latenceRem',
  'tempsSommeilTotal',
] as const;

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

  private pickNumericFields(data: PsgInterpretationPayload) {
    const result: Record<string, number | null> = {};
    for (const field of NUMERIC_FIELDS) {
      if (data[field] !== undefined) result[field] = data[field] ?? null;
    }
    return result;
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
    if (!data.conclusion?.trim()) {
      throw new BadRequestException("La conclusion de l'interprétation est requise");
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
        conclusion: data.conclusion,
        recommandations: data.recommandations ?? undefined,
        severite: data.severite ?? undefined,
        ...this.pickNumericFields(data),
      },
    });
  }

  async update(id: string, data: PsgInterpretationPayload) {
    const existing = await this.findOne(id);
    this.assertModifiable(existing);

    return this.prisma.psgInterpretation.update({
      where: { id },
      data: {
        ...(data.conclusion !== undefined ? { conclusion: data.conclusion } : {}),
        ...(data.recommandations !== undefined ? { recommandations: data.recommandations } : {}),
        ...(data.severite !== undefined ? { severite: data.severite } : {}),
        ...this.pickNumericFields(data),
      },
    });
  }

  async validate(id: string, validePar?: string) {
    const existing = await this.findOne(id);
    if (existing.statut === 'VALIDE') return existing;
    if (!existing.conclusion?.trim()) {
      throw new BadRequestException('Une interprétation sans conclusion ne peut pas être validée.');
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
      statut: interpretation.statut,
      iah: interpretation.iah,
      indexDesaturation: interpretation.indexDesaturation,
      spo2Moyenne: interpretation.spo2Moyenne,
      spo2Min: interpretation.spo2Min,
      efficaciteSommeil: interpretation.efficaciteSommeil,
      latenceEndormissement: interpretation.latenceEndormissement,
      latenceRem: interpretation.latenceRem,
      tempsSommeilTotal: interpretation.tempsSommeilTotal,
      severite: interpretation.severite,
      conclusion: interpretation.conclusion,
      recommandations: interpretation.recommandations,
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
