import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StatsPeriod = '7j' | '30j' | 'annee';

export type StatsResult = {
  periode: StatsPeriod;
  debut: string;
  fin: string;
  indicateurs: {
    examensRealises: number;
    consultations: number;
    comptesRendusValides: number;
    tauxValidation: number;
    urgences: number;
  };
  volumeExamens: Array<{ label: string; precedent: number; courant: number }>;
  typesExamens: Array<{ label: string; value: number }>;
  severite: Array<{ label: string; value: number }>;
  occupationSalles: Array<{ label: string; percent: number }>;
};

const PERIOD_DAYS: Record<StatsPeriod, number> = { '7j': 7, '30j': 30, annee: 365 };

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizePeriod(value?: string): StatsPeriod {
    if (value === '7j' || value === '30j' || value === 'annee') return value;
    return '30j';
  }

  /** Découpe la période en 5 tranches égales pour l'histogramme. */
  private buildBuckets(start: Date, end: Date) {
    const buckets: Array<{ label: string; start: Date; end: Date }> = [];
    const span = end.getTime() - start.getTime();
    const step = span / 5;

    for (let index = 0; index < 5; index += 1) {
      buckets.push({
        label: `S${index + 1}`,
        start: new Date(start.getTime() + step * index),
        end: new Date(start.getTime() + step * (index + 1)),
      });
    }

    return buckets;
  }

  private countIn(dates: Date[], start: Date, end: Date) {
    return dates.filter((date) => date >= start && date < end).length;
  }

  private tally(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }

  async getStats(periodInput?: string): Promise<StatsResult> {
    const periode = this.normalizePeriod(periodInput);
    const days = PERIOD_DAYS[periode];
    const fin = new Date();
    const debut = new Date(fin.getTime() - days * 24 * 60 * 60 * 1000);
    const debutPrecedent = new Date(debut.getTime() - days * 24 * 60 * 60 * 1000);

    const empty: StatsResult = {
      periode,
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      indicateurs: {
        examensRealises: 0,
        consultations: 0,
        comptesRendusValides: 0,
        tauxValidation: 0,
        urgences: 0,
      },
      volumeExamens: this.buildBuckets(debut, fin).map((bucket) => ({
        label: bucket.label,
        precedent: 0,
        courant: 0,
      })),
      typesExamens: [],
      severite: [],
      occupationSalles: [],
    };

    try {
      const [consultations, consultationsPrecedentes, examens, comptesRendus] =
        await Promise.all([
          this.prisma.consultationLocale.findMany({
            where: { date: { gte: debut, lte: fin } },
          }),
          this.prisma.consultationLocale.findMany({
            where: { date: { gte: debutPrecedent, lt: debut } },
          }),
          this.prisma.polysomnographiePlanification.findMany({
            where: { rdvDate: { gte: debut, lte: fin } },
          }),
          this.prisma.compteRendu.findMany({
            where: { createdAt: { gte: debut, lte: fin } },
          }),
        ]);

      const buckets = this.buildBuckets(debut, fin);
      const datesCourantes = consultations.map((item) => item.date);
      const decalage = debut.getTime() - debutPrecedent.getTime();
      const datesPrecedentes = consultationsPrecedentes.map(
        (item) => new Date(item.date.getTime() + decalage),
      );

      const comptesRendusValides = comptesRendus.filter(
        (item) => item.statut === 'VALIDE',
      ).length;

      const examensTermines = examens.filter((item) => item.statut === 'TERMINE');
      const salles = this.tally(
        examens.map((item) => item.salle).filter((salle): salle is string => Boolean(salle)),
      );
      const salleMax = salles[0]?.value ?? 0;

      return {
        periode,
        debut: debut.toISOString(),
        fin: fin.toISOString(),
        indicateurs: {
          examensRealises: examensTermines.length,
          consultations: consultations.length,
          comptesRendusValides,
          tauxValidation: comptesRendus.length
            ? Math.round((comptesRendusValides / comptesRendus.length) * 100)
            : 0,
          urgences: consultations.filter((item) => item.urgence).length,
        },
        volumeExamens: buckets.map((bucket) => ({
          label: bucket.label,
          courant: this.countIn(datesCourantes, bucket.start, bucket.end),
          precedent: this.countIn(datesPrecedentes, bucket.start, bucket.end),
        })),
        typesExamens: this.tally(
          consultations.map((item) => item.typeVisite || 'NON RENSEIGNÉ'),
        ),
        severite: this.tally(
          consultations.map((item) => (item.urgence ? 'Urgent' : 'Normal')),
        ),
        occupationSalles: salles.map((salle) => ({
          label: salle.label,
          percent: salleMax ? Math.round((salle.value / salleMax) * 100) : 0,
        })),
      };
    } catch (dbError) {
      this.logger.warn(
        `Base locale indisponible, statistiques vides renvoyées: ${dbError}`,
      );
      return empty;
    }
  }

  /** Charge utile d'export (le rendu PDF/Excel est fait côté client). */
  async exportStats(periodInput?: string) {
    const stats = await this.getStats(periodInput);
    return { ...stats, genereLe: new Date().toISOString() };
  }
}
