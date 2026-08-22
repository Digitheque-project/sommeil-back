import {
  Controller,
  Get,
  Headers,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';

type HospitalisationService = { id: string; name: string };

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
      "Alimente le sélecteur du formulaire d'hospitalisation, depuis l'annuaire " +
      'central du CHU. Permission `consultation:treat`.',
  })
  @ApiResponse({ status: 200, description: 'Liste des services' })
  @ApiResponse({
    status: 503,
    description: "Annuaire des services injoignable ou non configuré",
  })
  async getHospitalisationServices(
    @Headers('authorization') authorization?: string,
  ): Promise<HospitalisationService[]> {
    if (!this.SERVICES_URL) {
      throw new ServiceUnavailableException(
        "L'annuaire des services du CHU n'est pas configuré (SERVICES_URL).",
      );
    }

    try {
      // SERVICES_URL ne contient que la base URL. Le registre expose ses
      // routes à la racine (`GET /services`) ; `/services/api` n'est que le
      // point de montage de son swagger, pas un préfixe de route.
      //
      // Le registre exige un jeton porteur : on relaie celui de l'appelant,
      // sinon il répond 401.
      const response = await firstValueFrom(
        this.httpService.get(`${this.SERVICES_URL.replace(/\/+$/, '')}/services`, {
          timeout: 8000,
          headers: authorization ? { Authorization: authorization } : {},
        }),
      );

      const list = Array.isArray(response.data) ? response.data : [];

      return list.map((item: any) => ({
        id: String(item?.id ?? item?.code ?? item?.name),
        name: String(item?.name ?? item?.libelle ?? item?.nom ?? ''),
      }));
    } catch (error) {
      this.logger.error(`Annuaire des services non joignable: ${error}`);
      throw new ServiceUnavailableException(
        "L'annuaire des services du CHU est momentanément injoignable.",
      );
    }
  }
}
