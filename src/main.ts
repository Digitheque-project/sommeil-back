import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// En développement, charge le fichier .env local. En production (Render), les
// variables sont déjà injectées dans l'environnement : l'absence de fichier
// n'est pas une erreur.
try {
  process.loadEnvFile();
} catch {
  /* pas de fichier .env : on garde l'environnement tel quel */
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Préfixe global de l'API. Le swagger est exposé sur <baseUrl>/<apiPrefix>/docs,
  // soit par défaut : https://<baseUrl>/sommeil/api/docs
  const apiPrefix = process.env.API_PREFIX || 'sommeil/api';
  app.setGlobalPrefix(apiPrefix);

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const config = new DocumentBuilder()
    .setTitle('Service Sommeil - API')
    .setDescription(
      "Documentation Swagger publique de l'API du service sommeil. " +
        'Cette documentation est accessible librement par les services tiers pour ' +
        "découvrir les endpoints, les modèles et les exemples d'appels.\n\n" +
        'Les routes protégées restent sécurisées côté backend, mais la documentation ' +
        'et le schéma OpenAPI sont exposés publiquement.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'access-token',
    )
    .addTag(
      'consultations',
      'Gestion des consultations en lien avec le sommeil',
    )
    .addTag(
      'Prescriptions',
      'Gestion des prescriptions (CPAP, polysomnographie)',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    customSiteTitle: 'Service Sommeil - API',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 5000);
}
bootstrap();
