import { Module } from '@nestjs/common';
import { FsBrowseController } from './fs-browse.controller.js';
import { FsBrowseService } from './fs-browse.service.js';

@Module({
    controllers: [FsBrowseController],
    providers: [FsBrowseService],
})
export class FsBrowseModule {}
