import { Controller, Get, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';

type HospitalisationService = { id: string; name: string };

/**
 * Services cliniques d'accueil proposés dans le formulaire de demande
 * d'hospitalisation. Relayés depuis l'annuaire CHU quand il est joignable,
 * sinon depuis la liste de repli ci-dessous.
 */
const FALLBACK_SERVICES: HospitalisationService[] = [
  { id: 'pneumologie', name: 'Pneumologie' },
  { id: 'cardiologie', name: 'Cardiologie' },
  { id: 'neurologie', name: 'Neurologie' },
  { id: 'orl', name: 'ORL' },
  { id: 'medecine-interne', name: 'Médecine interne' },
  { id: 'reanimation', name: 'Réanimation' },
  { id: 'soins-intensifs', name: 'Soins intensifs' },
];

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  private readonly logger = new Logger(ServicesController.name);
  private readonly SERVICES_URL = process.env.SERVICES_URL;

  constructor(private readonly httpService: HttpService) {}

  @Get('hospitalisation')
  @ApiOperation({
    summary: "Services cliniques d'accueil pour une hospitalisation",
    description:
      "Alimente le sélecteur du formulaire d'hospitalisation. Permission `consultation:treat`.",
  })
  @ApiResponse({ status: 200, description: 'Liste des services' })
  async getHospitalisationServices(): Promise<HospitalisationService[]> {
    if (!this.SERVICES_URL) return FALLBACK_SERVICES;

    try {
      // SERVICES_URL ne contient que la base URL. Le registre expose ses
      // routes à la racine (`GET /services`) ; `/services/api` n'est que le
      // point de montage de son swagger, pas un préfixe de route.
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.SERVICES_URL.replace(/\/+$/, '')}/services`,
          { timeout: 8000 },
        ),
      );

      const list = Array.isArray(response.data) ? response.data : [];
      if (list.length === 0) return FALLBACK_SERVICES;

      return list.map((item: any) => ({
        id: String(item?.id ?? item?.code ?? item?.name),
        name: String(item?.name ?? item?.libelle ?? item?.nom ?? ''),
      }));
    } catch (error) {
      this.logger.warn(
        `Annuaire des services non joignable, liste de repli utilisée: ${error}`,
      );
      return FALLBACK_SERVICES;
    }
  }
}
