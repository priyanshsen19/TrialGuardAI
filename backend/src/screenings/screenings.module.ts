import { Module } from '@nestjs/common';
import { ScreeningsController } from './screenings.controller';
import { ScreeningsService } from './screenings.service';

@Module({ controllers: [ScreeningsController], providers: [ScreeningsService], exports: [ScreeningsService] })
export class ScreeningsModule {}
