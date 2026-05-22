import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PictureGalleryController } from './picture-gallery.controller';
import { PictureGalleryService } from './picture-gallery.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PictureGalleryController],
  providers: [PictureGalleryService],
  exports: [PictureGalleryService],
})
export class PictureGalleryModule {}
