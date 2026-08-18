import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CreerRdvDto = {
  patientId: string;
  patientNom: string;
  patientPrenom: string;
  patientDossier?: string;
  motif?: string;
  priorite?: string;
  dateRdv: string;
  heureDebut: string;
  heureFin: string;
  dureeMinutes?: number;
};

export type ModifierRdvDto = Partial<CreerRdvDto>;

export type ListerRdvsFiltres = {
  statut?: string;
  dateDebut?: string;
  dateFin?: string;
  patientId?: string;
};

@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService) {}

  async lister(filtres: ListerRdvsFiltres) {
    const where: Prisma.RendezVousPlanningWhereInput = {};
    if (filtres.statut) where.statut = filtres.statut;
    if (filtres.patientId) where.patientId = filtres.patientId;
    if (filtres.dateDebut || filtres.dateFin) {
      where.dateRdv = {
        ...(filtres.dateDebut ? { gte: new Date(filtres.dateDebut) } : {}),
        ...(filtres.dateFin ? { lte: new Date(filtres.dateFin) } : {}),
      };
    }

    return this.prisma.rendezVousPlanning.findMany({
      where,
      orderBy: [{ dateRdv: 'asc' }, { heureDebut: 'asc' }],
    });
  }

  async obtenirParId(id: string) {
    const rdv = await this.prisma.rendezVousPlanning.findUnique({
      where: { id },
    });
    if (!rdv) throw new NotFoundException('Rendez-vous non trouvé');
    return rdv;
  }

  private calculerHeureFin(heureDebut: string, dureeMinutes: number): string {
    const [h, m] = heureDebut.split(':').map(Number);
    const total = h * 60 + m + dureeMinutes;
    const heure = Math.floor(total / 60) % 24;
    const minute = total % 60;
    return `${String(heure).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  async creer(data: CreerRdvDto) {
    const dureeMinutes = data.dureeMinutes ?? 60;
    return this.prisma.rendezVousPlanning.create({
      data: {
        patientId: data.patientId,
        patientNom: data.patientNom,
        patientPrenom: data.patientPrenom,
        patientDossier: data.patientDossier,
        motif: data.motif,
        priorite: data.priorite ?? 'NORMALE',
        dateRdv: new Date(data.dateRdv),
        heureDebut: data.heureDebut,
        heureFin:
          data.heureFin || this.calculerHeureFin(data.heureDebut, dureeMinutes),
        dureeMinutes,
      },
    });
  }

  async modifier(id: string, data: ModifierRdvDto) {
    await this.obtenirParId(id);

    const dureeMinutes = data.dureeMinutes;
    const heureDebut = data.heureDebut;

    return this.prisma.rendezVousPlanning.update({
      where: { id },
      data: {
        ...(data.patientId !== undefined ? { patientId: data.patientId } : {}),
        ...(data.patientNom !== undefined
          ? { patientNom: data.patientNom }
          : {}),
        ...(data.patientPrenom !== undefined
          ? { patientPrenom: data.patientPrenom }
          : {}),
        ...(data.patientDossier !== undefined
          ? { patientDossier: data.patientDossier }
          : {}),
        ...(data.motif !== undefined ? { motif: data.motif } : {}),
        ...(data.priorite !== undefined ? { priorite: data.priorite } : {}),
        ...(data.dateRdv !== undefined
          ? { dateRdv: new Date(data.dateRdv) }
          : {}),
        ...(heureDebut !== undefined ? { heureDebut } : {}),
        ...(dureeMinutes !== undefined ? { dureeMinutes } : {}),
        ...(heureDebut !== undefined && dureeMinutes !== undefined
          ? { heureFin: this.calculerHeureFin(heureDebut, dureeMinutes) }
          : {}),
      },
    });
  }

  async annuler(id: string) {
    await this.obtenirParId(id);
    return this.prisma.rendezVousPlanning.update({
      where: { id },
      data: { statut: 'ANNULE' },
    });
  }

  async marquerNonRealise(id: string) {
    await this.obtenirParId(id);
    return this.prisma.rendezVousPlanning.update({
      where: { id },
      data: { statut: 'NON_REALISE' },
    });
  }

  async supprimer(id: string) {
    await this.obtenirParId(id);
    await this.prisma.rendezVousPlanning.delete({ where: { id } });
    return { success: true, id };
  }
}
