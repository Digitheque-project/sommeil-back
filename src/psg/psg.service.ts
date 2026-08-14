import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PsgService {
  private readonly logger = new Logger(PsgService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les examens sont identifiés soit par l'ID de la planification locale, soit
   * par l'ID de la prescription d'origine : l'interface manipule les deux.
   */
  private async findExam(id: string) {
    const exam =
      (await this.prisma.polysomnographiePlanification.findUnique({ where: { id } })) ??
      (await this.prisma.polysomnographiePlanification.findUnique({
        where: { prescriptionId: id },
      }));

    if (!exam) throw new NotFoundException('Examen de polysomnographie non trouvé');
    return exam;
  }

  async findAll(statut?: string) {
    return this.prisma.polysomnographiePlanification.findMany({
      where: statut ? { statut } : undefined,
      orderBy: { rdvDate: 'asc' },
    });
  }

  async findOne(id: string) {
    return this.findExam(id);
  }

  async update(
    id: string,
    data: { rdvDate?: string; rdvHeure?: string; salle?: string; motif?: string },
  ) {
    const exam = await this.findExam(id);
    if (exam.statut === 'TERMINE') {
      throw new ConflictException(
        'Cet examen est terminé : ses paramètres ne peuvent plus être modifiés.',
      );
    }

    return this.prisma.polysomnographiePlanification.update({
      where: { id: exam.id },
      data: {
        ...(data.rdvDate ? { rdvDate: new Date(data.rdvDate) } : {}),
        ...(data.rdvHeure ? { rdvHeure: data.rdvHeure } : {}),
        ...(data.salle !== undefined ? { salle: data.salle } : {}),
        ...(data.motif !== undefined ? { motif: data.motif } : {}),
      },
    });
  }

  /** Démarre l'acquisition en salle (permission `psg:start`). */
  async start(id: string, salle?: string) {
    const exam = await this.findExam(id);
    if (exam.statut === 'EN_COURS') {
      throw new ConflictException("L'enregistrement de cet examen est déjà en cours.");
    }
    if (exam.statut === 'TERMINE') {
      throw new ConflictException('Cet examen est déjà terminé.');
    }

    return this.prisma.polysomnographiePlanification.update({
      where: { id: exam.id },
      data: {
        statut: 'EN_COURS',
        demarreLe: new Date(),
        termineLe: null,
        ...(salle ? { salle } : {}),
      },
    });
  }

  /** Termine l'acquisition (permission `psg:stop`). */
  async stop(id: string) {
    const exam = await this.findExam(id);
    if (exam.statut !== 'EN_COURS') {
      throw new ConflictException(
        "Cet examen n'est pas en cours d'enregistrement : il ne peut pas être arrêté.",
      );
    }

    return this.prisma.polysomnographiePlanification.update({
      where: { id: exam.id },
      data: { statut: 'TERMINE', termineLe: new Date() },
    });
  }

  async remove(id: string) {
    const exam = await this.findExam(id);
    if (exam.statut === 'EN_COURS') {
      throw new ConflictException(
        "Arrêtez l'enregistrement avant de supprimer cet examen.",
      );
    }

    await this.prisma.polysomnographiePlanification.delete({ where: { id: exam.id } });
    return { success: true, id: exam.id };
  }

  /**
   * Export des données de l'examen (permission `psg:export_data`).
   * Les signaux bruts (EDF) proviennent de l'acquisition en salle ; tant qu'aucun
   * enregistreur n'est raccordé, on exporte les métadonnées de la séance.
   */
  async exportData(id: string) {
    const exam = await this.findExam(id);

    const durationMinutes =
      exam.demarreLe && exam.termineLe
        ? Math.round((exam.termineLe.getTime() - exam.demarreLe.getTime()) / 60000)
        : null;

    return {
      examen: {
        id: exam.id,
        prescriptionId: exam.prescriptionId,
        statut: exam.statut,
        salle: exam.salle,
        rdvDate: exam.rdvDate,
        rdvHeure: exam.rdvHeure,
        demarreLe: exam.demarreLe,
        termineLe: exam.termineLe,
        dureeMinutes: durationMinutes,
      },
      patient: {
        id: exam.patientId,
        nom: exam.patientNom,
        prenom: exam.patientPrenom,
      },
      motif: exam.motif,
      urgence: exam.urgence,
      signaux: [],
      genereLe: new Date().toISOString(),
    };
  }
}
