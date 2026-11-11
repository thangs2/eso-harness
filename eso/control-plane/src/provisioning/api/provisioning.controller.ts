import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ProvisioningApiService } from './provisioning-api.service.js';
import { ProvisionConsumerDto } from './dto/provision-consumer.dto.js';

@Controller('api/v1/consumers')
@UseGuards(AuthGuard)
export class ProvisioningController {
    constructor(private readonly provisioningService: ProvisioningApiService) {}

    @Post(':id/provision')
    @HttpCode(HttpStatus.OK)
    async provision(
        @Param('id') id: string,
        @Body() body: ProvisionConsumerDto = {}
    ) {
        return this.provisioningService.provision(id, body);
    }

    @Get(':id/setup')
    @HttpCode(HttpStatus.OK)
    async getSetup(@Param('id') id: string) {
        return this.provisioningService.getSetup(id);
    }
}
