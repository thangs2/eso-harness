import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/infrastructure/database.module.js';
import { ProvisioningController } from './provisioning.controller.js';
import { ProvisioningApiService } from './provisioning-api.service.js';

@Module({
    imports: [DatabaseModule],
    controllers: [ProvisioningController],
    providers: [ProvisioningApiService],
    exports: [ProvisioningApiService],
})
export class ProvisioningApiModule {}
