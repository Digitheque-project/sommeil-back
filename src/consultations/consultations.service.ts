import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  // URL du service consultation externe - à configurer via variables d'environnement
  private readonly CONSULTATION_EXTERNE_URL =
    process.env.CONSULTATION_EXTERNE_URL || 'http://localhost:3001';

  constructor(private readonly httpService: HttpService) {}

  private async getAuthToken(): Promise<string> {
    // Récupérer le token depuis l'en-tête Authorization de la requête
    // Pour l'instant, on utilise une variable d'environnement ou un token par défaut
    return process.env.CONSULTATION_EXTERNE_TOKEN || '';
  }

  private isConnectionError(error: any): boolean {
    if (error instanceof AxiosError) {
      return error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET';
    }
    return false;
  }

  async getAllConsultations(filters: any) {
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations`, {
          headers,
          params: filters,
        }),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service consultation externe non disponible (${this.CONSULTATION_EXTERNE_URL}), utilisation des données mockées`,
        );
        return this.getMockConsultations();
      }
      this.logger.error(
        `Erreur lors de la récupération des consultations: ${err.message}`,
      );
      throw error;
    }
  }

  async getConsultationById(id: number) {
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/${id}`,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service consultation externe non disponible, utilisation des données mockées pour consultation ${id}`,
        );
        return this.getMockConsultation(id);
      }
      this.logger.error(
        `Erreur lors de la récupération de la consultation ${id}: ${err.message}`,
      );
      throw new NotFoundException('Consultation non trouvée');
    }
  }

  async finalizeConsultation(id: number, data: any) {
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/finalize`,
          data,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service consultation externe non disponible, finalisation mockée pour consultation ${id}`,
        );
        return { success: true, message: 'Consultation finalisée (mock)' };
      }
      this.logger.error(
        `Erreur lors de la finalisation de la consultation ${id}: ${err.message}`,
      );
      throw error;
    }
  }

  async traiterConsultation(id: number, data: any) {
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/traiter`,
          data,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service consultation externe non disponible, traitement mocké pour consultation ${id}`,
        );
        return { success: true, message: 'Consultation traitée (mock)' };
      }
      this.logger.error(
        `Erreur lors du traitement de la consultation ${id}: ${err.message}`,
      );
      throw error;
    }
  }

  async getPatientConsultationHistory(patientId: string) {
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/patient/${patientId}/history`,
          {
            headers,
          },
        ),
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(
          `Service consultation externe non disponible, historique mocké pour patient ${patientId}`,
        );
        return [];
      }
      this.logger.error(
        `Erreur lors de la récupération de l'historique du patient ${patientId}: ${err.message}`,
      );
      throw error;
    }
  }

  private getMockConsultations() {
    return [
      {
        id: 1,
        date: new Date().toISOString(),
        heure: '09:00',
        motif: 'Apnée suspectée / fatigue diurne',
        statut: 'EN_COURS',
        typeVisite: 'INITIALE',
        ugence: false,
        arriveeAccueil: true,
        estReport: false,
        patientId: 'PAT001',
        patient: {
          displayName: 'MARCEL, Sophie',
          prenom: 'Sophie',
          nom: 'Marcel',
          dossier: 'DOS001',
          priseEnCharge: { companyName: 'CNAM', isActive: true },
        },
        medecinId: 'MED001',
        observation: { diagnostic: 'AOS légère à modérée', notes: '' },
      },
      {
        id: 2,
        date: new Date().toISOString(),
        heure: '10:30',
        motif: 'Contrôle CPAP',
        statut: 'EN_ATTENTE',
        typeVisite: 'CONTROLE',
        ugence: false,
        arriveeAccueil: false,
        estReport: false,
        patientId: 'PAT002',
        patient: {
          displayName: 'DUPONT, Jean',
          prenom: 'Jean',
          nom: 'Dupont',
          dossier: 'DOS002',
          priseEnCharge: null,
        },
        medecinId: 'MED001',
        observation: { diagnostic: '', notes: '' },
      },
      {
        id: 3,
        date: new Date().toISOString(),
        heure: '14:00',
        motif: 'Insomnie chronique',
        statut: 'EN_ATTENTE',
        typeVisite: 'INITIALE',
        ugence: true,
        arriveeAccueil: false,
        estReport: false,
        patientId: 'PAT003',
        patient: {
          displayName: 'MARTIN, Marie',
          prenom: 'Marie',
          nom: 'Martin',
          dossier: 'DOS003',
          priseEnCharge: { companyName: 'MGEN', isActive: true },
        },
        medecinId: 'MED001',
        observation: { diagnostic: '', notes: '' },
      },
    ];
  }

  private getMockConsultation(id: number) {
    const mock = this.getMockConsultations().find((c) => c.id === id);
    if (!mock) {
      throw new NotFoundException('Consultation non trouvée');
    }
    return mock;
  }
}
