import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);
  
  // URL du service consultation externe - à configurer via variables d'environnement
  private readonly CONSULTATION_EXTERNE_URL = process.env.CONSULTATION_EXTERNE_URL || 'http://localhost:3001';

  constructor(private readonly httpService: HttpService) {}

  private async getAuthToken(): Promise<string> {
    // Récupérer le token depuis l'en-tête Authorization de la requête
    // Pour l'instant, on utilise une variable d'environnement ou un token par défaut
    return process.env.CONSULTATION_EXTERNE_TOKEN || '';
  }

  async getAllConsultations(filters: any) {
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
      this.logger.error(`Erreur lors de la récupération des consultations: ${err.message}`);
      throw error;
    }
  }

  async getConsultationById(id: number) {
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
      this.logger.error(`Erreur lors de la récupération de la consultation ${id}: ${err.message}`);
      throw new NotFoundException('Consultation non trouvée');
    }
  }

  async finalizeConsultation(id: number, data: any) {
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
      this.logger.error(`Erreur lors de la finalisation de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  async traiterConsultation(id: number, data: any) {
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
      this.logger.error(`Erreur lors du traitement de la consultation ${id}: ${err.message}`);
      throw error;
    }
  }

  async getPatientConsultationHistory(patientId: string) {
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
      this.logger.error(`Erreur lors de la récupération de l'historique du patient ${patientId}: ${err.message}`);
      throw error;
    }
  }
}
