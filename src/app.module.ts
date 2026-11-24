import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ApiModule } from './api/api.module';
import { AccionModule } from './accion/accion.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    ConfiguracionModule,
    AccionModule,
    ApiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
