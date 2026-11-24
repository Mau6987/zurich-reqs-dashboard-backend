import { Module } from '@nestjs/common';
import { AccionController } from './accion.controller';
import { AccionService } from './accion.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AccionController],
  providers: [AccionService],
})
export class AccionModule {}
