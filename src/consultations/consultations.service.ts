import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  // URL du service consultation externe - à configurer via variables d'environnement
  private readonly CONSULTATION_EXTERNE_URL =
    process.env.CONSULTATION_EXTERNE_URL || 'http://localhost:3001';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService
  ) {}

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
    // Essayer d'abord la base de données locale
    try {
      const where: any = {};
      if (filters.date) {
        where.date = new Date(filters.date);
      }
      if (filters.dateFrom) {
        where.date = { gte: new Date(filters.dateFrom) };
      }
      if (filters.dateTo) {
        where.date = { ...where.date, lte: new Date(filters.dateTo) };
      }
      if (filters.archived !== undefined) {
        where.archived = filters.archived;
      }

      const consultations = await this.prisma.consultationLocale.findMany({
        where,
        include: {
          observations: true,
          compteRendus: true,
        },
        orderBy: { date: 'desc' },
      });

      return consultations;
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
      
      // Fallback vers API externe
      try {
        const token = await this.getAuthToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const response = await firstValueFrom(
          this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations`, {
            headers,
            params: filters,
          })
        );

        return response.data;
      } catch (error) {
        const err = error as AxiosError;
        if (this.isConnectionError(error)) {
          this.logger.warn(`Service consultation externe non disponible, utilisation des données mockées`);
          return this.getMockConsultations();
        }
        this.logger.error(`Erreur lors de la récupération des consultations: ${err.message}`);
        throw error;
      }
    }
  }

  async getConsultationById(id: string) {
    // Essayer d'abord la base de données locale
    try {
      const consultation = await this.prisma.consultationLocale.findUnique({
        where: { id },
        include: {
          observations: true,
          compteRendus: true,
        },
      });

      if (consultation) {
        return consultation;
      }
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}`, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(`Service consultation externe non disponible, utilisation des données mockées pour consultation ${id}`);
        return this.getMockConsultation(+id);
      }
      this.logger.error(`Erreur lors de la récupération de la consultation ${id}: ${err.message}`);
      throw new NotFoundException('Consultation non trouvée');
    }
  }

  async finalizeConsultation(id: string, data: any) {
    // Sauvegarder dans la base de données locale
    try {
      const consultation = await this.prisma.consultationLocale.update({
        where: { id },
        data: {
          statut: 'TERMINE',
          observations: {
            create: {
              diagnostic: data.diagnostic || '',
              notes: data.notes || '',
            },
          },
        },
      });
      return consultation;
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/finalize`, data, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(`Service consultation externe non disponible, finalisation mockée pour consultation ${id}`);
        return { success: true, message: 'Consultation finalisée (mock)' };
      }
      this.logger.error(`Erreur lors de la finalisation de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Traduit une action de l'interface en mise à jour locale.
   * Retourne `null` quand l'action n'a pas d'effet sur la consultation locale
   * (elle est alors uniquement relayée au service externe).
   */
  private buildTraiterUpdate(data: any): Record<string, any> | null {
    switch (data.action) {
      case 'ouvrir':
        return { statut: 'EN_COURS' };
      case 'terminer':
        return { statut: 'TERMINE' };
      case 'annuler':
        return { statut: 'ANNULE' };
      case 'reporter':
        // Le report replace la consultation en attente à la nouvelle date.
        return {
          statut: 'EN_ATTENTE',
          estReport: true,
          ...(data.nouvelleDate ? { date: new Date(data.nouvelleDate) } : {}),
          ...(data.nouvelleHeure ? { heure: data.nouvelleHeure } : {}),
        };
      case 'controle':
      case 'hospitalisation':
      case 'examen':
        return null;
      default:
        throw new BadRequestException(
          `Action inconnue : ${data.action}. Actions valides : ouvrir, annuler, terminer, controle, examen, hospitalisation, reporter.`,
        );
    }
  }

  async traiterConsultation(id: string, data: any) {
    const updateData = this.buildTraiterUpdate(data);

    // Mettre à jour dans la base de données locale
    try {
      if (updateData === null) {
        // Aucune transition de statut : on renvoie la consultation telle quelle
        // pour que l'interface puisse confirmer la prise en compte.
        const current = await this.prisma.consultationLocale.findUnique({
          where: { id },
        });
        if (current) {
          return { success: true, action: data.action, consultation: current };
        }
      } else {
        const consultation = await this.prisma.consultationLocale.update({
          where: { id },
          data: updateData,
        });
        return { success: true, action: data.action, consultation };
      }
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.post(`${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/traiter`, data, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(`Service consultation externe non disponible, traitement mocké pour consultation ${id}`);
        return { success: true, message: 'Consultation traitée (mock)' };
      }
      this.logger.error(`Erreur lors du traitement de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  async getPatientConsultationHistory(patientId: string) {
    // Essayer d'abord la base de données locale
    try {
      const consultations = await this.prisma.consultationLocale.findMany({
        where: { patientId },
        include: {
          observations: true,
          compteRendus: true,
        },
        orderBy: { date: 'desc' },
      });

      return consultations;
    } catch (dbError) {
      this.logger.warn(`Erreur base de données locale, tentative API externe: ${dbError}`);
    }

    // Fallback vers API externe
    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await firstValueFrom(
        this.httpService.get(`${this.CONSULTATION_EXTERNE_URL}/consultations/patient/${patientId}/history`, {
          headers,
        })
      );

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      if (this.isConnectionError(error)) {
        this.logger.warn(`Service consultation externe non disponible, historique mocké pour patient ${patientId}`);
        return [];
      }
      this.logger.error(`Erreur lors de la récupération de l'historique du patient ${patientId}: ${err.message}`);
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

  // Nouvelles méthodes CRUD pour la base de données locale
  async createConsultation(data: any) {
    return this.prisma.consultationLocale.create({
      data: {
        consultationId: data.consultationId || data.id,
        date: new Date(data.date),
        heure: data.heure,
        motif: data.motif,
        statut: data.statut || 'EN_ATTENTE',
        typeVisite: data.typeVisite,
        urgence: data.urgence || false,
        arriveeAccueil: data.arriveeAccueil || false,
        estReport: data.estReport || false,
        patientId: data.patientId,
        patientNom: data.patient?.nom || data.patientNom,
        patientPrenom: data.patient?.prenom || data.patientPrenom,
        patientDossier: data.patient?.dossier || data.patientDossier,
        medecinId: data.medecinId,
      },
    });
  }

  async updateConsultation(id: string, data: any) {
    return this.prisma.consultationLocale.update({
      where: { id },
      data,
    });
  }

  async archiveConsultation(id: string) {
    return this.prisma.consultationLocale.update({
      where: { id },
      data: { archived: true },
    });
  }

  async addObservation(consultationId: string, data: { diagnostic?: string; notes?: string }) {
    return this.prisma.observation.create({
      data: {
        consultationId,
        diagnostic: data.diagnostic,
        notes: data.notes,
      },
    });
  }

  async addCompteRendu(
    consultationId: string,
    data: { titre: string; contenu: string; type: string },
  ) {
    const consultation = await this.prisma.consultationLocale.findUnique({
      where: { id: consultationId },
    });

    return this.prisma.compteRendu.create({
      data: {
        consultationId,
        titre: data.titre,
        contenu: data.contenu,
        type: data.type ?? 'MEDICAL',
        patientId: consultation?.patientId,
        patientNom: consultation
          ? `${consultation.patientPrenom} ${consultation.patientNom}`.trim()
          : undefined,
      },
    });
  }

  async getCompteRendus(consultationId: string) {
    return this.prisma.compteRendu.findMany({
      where: { consultationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Consultations du jour dont le patient n'a pas encore été pris en charge. */
  async getWaitingConsultations() {
    try {
      return await this.prisma.consultationLocale.findMany({
        where: { statut: { in: ['EN_ATTENTE', 'EN_COURS'] }, archived: false },
        include: { observations: true },
        orderBy: [{ urgence: 'desc' }, { heure: 'asc' }],
      });
    } catch (dbError) {
      this.logger.warn(`Base locale indisponible pour la file d'attente: ${dbError}`);
      return this.getMockConsultations().filter(
        (item) => item.statut !== 'TERMINE',
      );
    }
  }

  /** Consultations de contrôle (suivi d'une consultation initiale). */
  async getControlConsultations() {
    try {
      return await this.prisma.consultationLocale.findMany({
        where: { typeVisite: 'CONTROLE', archived: false },
        include: { observations: true },
        orderBy: { date: 'desc' },
      });
    } catch (dbError) {
      this.logger.warn(`Base locale indisponible pour les contrôles: ${dbError}`);
      return this.getMockConsultations().filter(
        (item) => item.typeVisite === 'CONTROLE',
      );
    }
  }

  /** Marque (ou annule) l'arrivée du patient à l'accueil. */
  async markArrival(
    id: string,
    payload: { arriveeAccueil?: boolean; arriveeAccueilAt?: string | null },
  ) {
    const arrived = payload.arriveeAccueil ?? true;

    try {
      const consultation = await this.prisma.consultationLocale.update({
        where: { id },
        data: { arriveeAccueil: arrived },
      });
      return { success: true, consultation };
    } catch (dbError) {
      this.logger.warn(`Base locale indisponible, relais vers l'API externe: ${dbError}`);
    }

    try {
      const token = await this.getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await firstValueFrom(
        this.httpService.patch(
          `${this.CONSULTATION_EXTERNE_URL}/consultations/${id}/arrival`,
          payload,
          { headers },
        ),
      );
      return response.data;
    } catch (error) {
      if (this.isConnectionError(error)) {
        return { success: true, arriveeAccueil: arrived, mock: true };
      }
      throw error;
    }
  }

  /** Note libre attachée à une consultation de contrôle. */
  async saveControlNote(id: string, note: string) {
    try {
      const existing = await this.prisma.observation.findFirst({
        where: { consultationId: id },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return await this.prisma.observation.update({
          where: { id: existing.id },
          data: { notes: note },
        });
      }

      return await this.prisma.observation.create({
        data: { consultationId: id, notes: note },
      });
    } catch (dbError) {
      this.logger.warn(`Base locale indisponible pour la note de contrôle: ${dbError}`);
      return { success: true, note, mock: true };
    }
  }

  async deleteConsultation(id: string) {
    await this.prisma.consultationLocale.delete({ where: { id } });
    return { success: true, id };
  }
}
