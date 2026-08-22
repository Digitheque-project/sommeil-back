import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

export type PolysomnographieItem = {
  id: string;
  patientId: string;
  patientNom: string;
  patientPrenom: string;
  motif: string;
  statut: string;
  urgence: boolean;
  createdAt: string;
  rdvDate?: string | null;
  rdvHeure?: string | null;
};

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  // URL de base du service prescriptions (sans préfixe ni suffixe) - à configurer via variables d'environnement.
  private readonly PRESCRIPTIONS_URL = process.env.PRESCRIPTIONS_URL || 'https://prescriptionback-production.up.railway.app';
  private readonly PRESCRIPTIONS_API_PATH = '/prescriptions/medicale';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService
  ) {}

  // URL de base des prescriptions de polysomnographie reçues des services externes.
  // POLYSOMNOGRAPHIE_URL est une base URL (sans préfixe ni suffixe) ; le préfixe
  // de chemin est ajouté ici. Par défaut dérivée de PRESCRIPTIONS_URL (base URL).
  private get polysomnographieUrl(): string {
    const configured = process.env.POLYSOMNOGRAPHIE_URL;
    if (configured)
      return `${configured.replace(/\/+$/, '')}/prescriptions/polysomnographie`;
    return `${this.PRESCRIPTIONS_URL}/prescriptions/polysomnographie`;
  }
  private isConnectionError(error: any): boolean {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      return (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        (status !== undefined && status >= 500)
      );
    }
    return false;
  }

  private async getPlanificationsSafely(): Promise<Map<string, { rdvDate: Date; rdvHeure: string }>> {
    try {
      const planifications = await this.prisma.polysomnographiePlanification.findMany();
      return new Map(
        planifications.map((p) => [p.prescriptionId, { rdvDate: p.rdvDate, rdvHeure: p.rdvHeure }]),
      );
    } catch (dbError) {
      this.logger.warn(
        `Base de données locale indisponible, planifications ignorées: ${dbError}`,
      );
      return new Map();
    }
  }

  async getPatientPrescriptions(patientId: string, chuId?: string) {
    try {
      const params: any = {};
      if (chuId) params.chuId = chuId;

      const response = await firstValueFrom(
        this.httpService.get(`${this.PRESCRIPTIONS_URL}${this.PRESCRIPTIONS_API_PATH}/patient/${patientId}`, { params }),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Service prescriptions injoignable (${this.PRESCRIPTIONS_URL}) pour le patient ${patientId}`,
        );
        throw new ServiceUnavailableException(
          'Les prescriptions sont momentanément indisponibles (service prescriptions injoignable).',
        );
      }
      this.logger.error(
        `Erreur lors de la récupération des prescriptions du patient ${patientId}: ${err.message}`,
      );
      throw error;
    }
  }

  private normalizePolysomnographie(raw: any, scheduledPlanification?: { rdvDate: Date; rdvHeure: string }): PolysomnographieItem {
    const id = String(raw?.id ?? raw?.prescriptionId ?? '');

    return {
      id,
      patientId: String(raw?.patientId ?? ''),
      patientNom:
        raw?.patientNom ?? raw?.patient?.nom ?? raw?.patient?.lastname ?? '',
      patientPrenom:
        raw?.patientPrenom ??
        raw?.patient?.prenom ??
        raw?.patient?.firstname ??
        '',
      motif: raw?.motif ?? raw?.contexteClinique ?? raw?.observation ?? '',
      statut: scheduledPlanification ? 'PLANIFIE' : (raw?.statut ?? 'EN_ATTENTE'),
      urgence: Boolean(raw?.urgence),
      createdAt: raw?.createdAt ?? new Date().toISOString(),
      rdvDate: scheduledPlanification?.rdvDate.toISOString() ?? raw?.rdvDate ?? null,
      rdvHeure: scheduledPlanification?.rdvHeure ?? raw?.heure ?? raw?.rdvHeure ?? null,
    };
  }

  async getPolysomnographiePrescriptions() {
    try {
      const response = await firstValueFrom(
        this.httpService.get(this.polysomnographieUrl, { timeout: 8000 }),
      );

      const list = Array.isArray(response.data) ? response.data : [];

      // Récupérer les planifications depuis la base de données locale
      const planificationsMap = await this.getPlanificationsSafely();

      return list.map((item: any) => 
        this.normalizePolysomnographie(item, planificationsMap.get(String(item?.id ?? item?.prescriptionId)))
      );
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.error(
          `Service prescriptions injoignable (${this.polysomnographieUrl}) pour la liste polysomnographie`,
        );
        throw new ServiceUnavailableException(
          'Les prescriptions de polysomnographie sont momentanément indisponibles (service prescriptions injoignable).',
        );
      }
      this.logger.error(`Erreur lors de la récupération des polysomnographies: ${err.message}`);
      throw error;
    }
  }

  async schedulePolysomnographie(
    id: string,
    data: { rdvDate: string; rdvHeure?: string },
  ) {
    if (!data?.rdvDate) {
      throw new BadRequestException('Une date de rendez-vous est requise');
    }

    const items = await this.getPolysomnographiePrescriptions();
    const target = items.find((item) => item.id === id);
    if (!target) {
      throw new NotFoundException('Prescription polysomnographie non trouvée');
    }

    // Sauvegarder dans la base de données locale
    try {
      const planification = await this.prisma.polysomnographiePlanification.upsert({
        where: { prescriptionId: id },
        update: {
          rdvDate: new Date(data.rdvDate),
          rdvHeure: data.rdvHeure ?? target.rdvHeure ?? '20:00',
          statut: 'PLANIFIE',
        },
        create: {
          prescriptionId: id,
          patientId: target.patientId,
          patientNom: target.patientNom,
          patientPrenom: target.patientPrenom,
          motif: target.motif,
          rdvDate: new Date(data.rdvDate),
          rdvHeure: data.rdvHeure ?? target.rdvHeure ?? '20:00',
          statut: 'PLANIFIE',
          urgence: target.urgence,
        },
      });

      // La planification est passée en second argument : sans elle, la réponse
      // reprenait le statut d'origine (EN_ATTENTE) alors que le rendez-vous
      // vient d'être posé.
      return {
        success: true,
        ...this.normalizePolysomnographie(
          { ...target, id },
          { rdvDate: planification.rdvDate, rdvHeure: planification.rdvHeure },
        ),
      };
    } catch (dbError) {
      // L'ancien repli renvoyait un rendez-vous « planifié » construit en
      // mémoire alors que rien n'était persisté : le praticien voyait un RDV
      // qui disparaissait au rechargement. On remonte l'échec.
      this.logger.error(`Erreur base de données locale pour planification: ${dbError}`);
      throw new ServiceUnavailableException(
        "Le rendez-vous n'a pas pu être enregistré (base locale injoignable).",
      );
    }
  }

  async updatePrescriptionStatus(
    id: string,
    statut: string,
    actionParId?: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService.put(
          `${this.PRESCRIPTIONS_URL}${this.PRESCRIPTIONS_API_PATH}/${id}/statut`,
          { statut, actionParId },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        // Ne pas annoncer un succès sans écriture : le statut affiché
        // divergerait de celui du service prescriptions.
        this.logger.error(
          `Service prescriptions injoignable pour la mise à jour du statut de ${id}`,
        );
        throw new ServiceUnavailableException(
          "Le statut n'a pas pu être mis à jour (service prescriptions injoignable).",
        );
      }
      this.logger.error(
        `Erreur lors de la mise à jour du statut de la prescription ${id}: ${err.message}`,
      );
      throw error;
    }
  }

  // Nouvelles méthodes CRUD pour la base de données locale
  async getAllPlanifications() {
    return this.prisma.polysomnographiePlanification.findMany({
      orderBy: { rdvDate: 'asc' },
    });
  }

  async getPlanificationById(id: string) {
    return this.prisma.polysomnographiePlanification.findUnique({
      where: { id },
    });
  }

  async deletePlanification(id: string) {
    return this.prisma.polysomnographiePlanification.delete({
      where: { id },
    });
  }

  async createArchive(data: { type: string; referenceId: string; titre: string; description?: string; donnees: any; archivedBy?: string }) {
    return this.prisma.archive.create({
      data: {
        type: data.type,
        referenceId: data.referenceId,
        titre: data.titre,
        description: data.description,
        donnees: data.donnees,
        archivedBy: data.archivedBy,
      },
    });
  }

  async getArchives(type?: string) {
    return this.prisma.archive.findMany({
      where: type ? { type } : undefined,
      orderBy: { archivedAt: 'desc' },
    });
  }
}
