import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

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

  // Base URL du service prescriptions (sans préfixe ni suffixe) - à configurer via variables d'environnement.
  // Le code ajoute automatiquement le préfixe de chemin ci-dessous.
  private readonly PRESCRIPTIONS_BASE_URL = (
    process.env.PRESCRIPTIONS_URL ||
    'https://prescriptionback-production.up.railway.app'
  ).replace(/\/+$/, '');

  private readonly PRESCRIPTIONS_API_PATH = '/prescriptions/medicale';
  private readonly POLYSOMNOGRAPHIE_API_PATH =
    '/prescriptions/polysomnographie';

  // Rendez-vous de polysomnographie planifiés via l'interface (stockage mémoire).
  // À terme, ces planifications devront être persistées côté service prescription.
  private readonly scheduledPolysomnographies = new Map<
    string,
    { rdvDate: string; rdvHeure: string }
  >();

  constructor(private readonly httpService: HttpService) {}

  // URL de base des prescriptions de polysomnographie reçues des services externes.
  // POLYSOMNOGRAPHIE_URL est une base URL (sans préfixe ni suffixe) ; le préfixe
  // de chemin est ajouté ici. Par défaut dérivée de PRESCRIPTIONS_URL (base URL).
  private get polysomnographieUrl(): string {
    const configured = process.env.POLYSOMNOGRAPHIE_URL;
    if (configured)
      return `${configured.replace(/\/+$/, '')}${this.POLYSOMNOGRAPHIE_API_PATH}`;
    return `${this.PRESCRIPTIONS_BASE_URL}${this.POLYSOMNOGRAPHIE_API_PATH}`;
  }

  private isConnectionError(error: any): boolean {
    if (error instanceof AxiosError) {
      return (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.response?.status === 401
      );
    }
    return false;
  }

  async getPatientPrescriptions(patientId: string, chuId?: string) {
    try {
      const params: any = {};
      if (chuId) params.chuId = chuId;

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.PRESCRIPTIONS_BASE_URL}${this.PRESCRIPTIONS_API_PATH}/patient/${patientId}`,
          { params },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service prescriptions non disponible (${this.PRESCRIPTIONS_BASE_URL}), utilisation des données mockées pour patient ${patientId}`,
        );
        return this.getMockPrescriptions();
      }
      this.logger.error(
        `Erreur lors de la récupération des prescriptions du patient ${patientId}: ${err.message}`,
      );
      throw error;
    }
  }

  private normalizePolysomnographie(raw: any): PolysomnographieItem {
    const id = String(raw?.id ?? raw?.prescriptionId ?? '');
    const scheduled = id ? this.scheduledPolysomnographies.get(id) : undefined;

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
      statut: scheduled ? 'PLANIFIE' : (raw?.statut ?? 'EN_ATTENTE'),
      urgence: Boolean(raw?.urgence),
      createdAt: raw?.createdAt ?? new Date().toISOString(),
      rdvDate: scheduled?.rdvDate ?? raw?.rdvDate ?? null,
      rdvHeure: scheduled?.rdvHeure ?? raw?.heure ?? raw?.rdvHeure ?? null,
    };
  }

  async getPolysomnographiePrescriptions() {
    try {
      const response = await firstValueFrom(
        this.httpService.get(this.polysomnographieUrl, { timeout: 8000 }),
      );

      const list = Array.isArray(response.data) ? response.data : [];
      return list.map((item: any) => this.normalizePolysomnographie(item));
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service prescriptions non disponible (${this.polysomnographieUrl}), utilisation des données mockées pour la liste polysomnographie`,
        );
        return this.getMockPolysomnographies().map((item) =>
          this.normalizePolysomnographie(item),
        );
      }
      this.logger.error(
        `Erreur lors de la récupération des polysomnographies: ${err.message}`,
      );
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

    this.scheduledPolysomnographies.set(id, {
      rdvDate: data.rdvDate,
      rdvHeure: data.rdvHeure ?? target.rdvHeure ?? '20:00',
    });

    return {
      success: true,
      ...this.normalizePolysomnographie({ ...target, id }),
    };
  }

  async updatePrescriptionStatus(
    id: string,
    statut: string,
    actionParId?: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.httpService.put(
          `${this.PRESCRIPTIONS_BASE_URL}${this.PRESCRIPTIONS_API_PATH}/${id}/statut`,
          { statut, actionParId },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service prescriptions non disponible, mise à jour mockée pour prescription ${id}`,
        );
        return { success: true, message: 'Statut mis à jour (mock)' };
      }
      this.logger.error(
        `Erreur lors de la mise à jour du statut de la prescription ${id}: ${err.message}`,
      );
      throw error;
    }
  }

  private getMockPrescriptions() {
    return [
      {
        id: '1',
        type: 'CPAP',
        label: 'Prescription CPAP',
        detail: 'Pression 8 cmH2O',
        statut: 'planned',
        patientId: 'PAT001',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'O2',
        label: 'Prescription O2',
        detail: '1 L/min',
        statut: 'planned',
        patientId: 'PAT001',
        createdAt: new Date().toISOString(),
      },
      {
        id: '3',
        type: 'EEG',
        label: 'Prescription EEG',
        detail: 'Suivi nocturne',
        statut: 'planned',
        patientId: 'PAT001',
        createdAt: new Date().toISOString(),
      },
    ];
  }

  private getMockPolysomnographies() {
    return [
      {
        id: 'PSG-001',
        patientId: 'PAT001',
        patientNom: 'Marcel',
        patientPrenom: 'Sophie',
        motif: 'Apnée du sommeil suspectée / fatigue diurne',
        statut: 'EN_ATTENTE',
        urgence: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'PSG-002',
        patientId: 'PAT002',
        patientNom: 'Dupont',
        patientPrenom: 'Jean',
        motif: 'Ronflements importants, SAOS à confirmer',
        statut: 'EN_ATTENTE',
        urgence: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'PSG-003',
        patientId: 'PAT003',
        patientNom: 'Martin',
        patientPrenom: 'Marie',
        motif: 'Insomnie chronique, test de latence à programmer',
        statut: 'EN_ATTENTE',
        urgence: true,
        createdAt: new Date().toISOString(),
      },
    ];
  }
}
