import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @ApiOperation({
    summary: 'Importer une photo pour un compte rendu',
    description:
      "Relaye le fichier vers le service-upload du CHU et renvoie son URL. Champ multipart `file` requis.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Fichier importé' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers('authorization') authorization?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Photo manquante.');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Le fichier doit être une image.');
    }

    return this.uploadsService.uploadFile(file, authorization);
  }
}
