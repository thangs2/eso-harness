import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard.js';
import { FsBrowseResult, FsBrowseService } from './fs-browse.service.js';

@Controller('api/v1/fs')
@UseGuards(AuthGuard)
export class FsBrowseController {
    constructor(private readonly fs: FsBrowseService) {}

    @Get('list')
    async list(@Query('path') path?: string): Promise<FsBrowseResult> {
        return this.fs.list(path);
    }
}
