import {
    BadRequestException,
    ConflictException,
    HttpException,
    Inject,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/infrastructure/database.service.js';
import { fail } from '../../platform/registry/errors.js';
import {
    assertConsumerId,
    BunSqlPlatformStore,
    type PlatformStore,
} from '../../platform/registry/store.js';
import { SchemaProvisioningService, SchemaMismatchError } from '../schema/schema-provisioning.service.js';
import { MaterialProvisioningService } from '../material/material-provisioning.service.js';
import { ProvisioningStateService } from '../state/provisioning-state.service.js';

export interface ProvisionOptions {
    profile?: Record<string, unknown>;
    zones?: unknown[];
}

export interface ProvisionResponse {
    consumer: string;
    status: 'provisioned';
    schema: string;
    material: {
        agents: boolean;
        harness: string;
        manifest: string;
    };
    setup: {
        ready: boolean;
        updated_at: string;
        updatedAt: string;
    };
}

@Injectable()
export class ProvisioningApiService {
    private customStore?: PlatformStore;

    constructor(
        private readonly dbService: DatabaseService,
        @Optional() @Inject('PLATFORM_STORE') store?: PlatformStore
    ) {
        if (store) {
            this.customStore = store;
        }
    }

    setStore(store: PlatformStore): void {
        this.customStore = store;
    }

    getStore(): PlatformStore {
        if (this.customStore) {
            return this.customStore;
        }
        const db = this.dbService.getDatabase();
        if (db && typeof db.ensurePlatformSchema === 'function') {
            return db as PlatformStore;
        }
        if (db && typeof db.unsafe === 'function') {
            return new BunSqlPlatformStore(db);
        }
        fail('DATABASE_UNAVAILABLE', 'No database handle for provisioning API');
    }

    private getServices() {
        const store = this.getStore();
        return {
            store,
            schemaService: new SchemaProvisioningService(store),
            materialService: new MaterialProvisioningService(store),
            stateService: new ProvisioningStateService(store),
        };
    }

    async provision(consumerId: string, options: ProvisionOptions = {}): Promise<ProvisionResponse> {
        const { schemaService, materialService, stateService } = this.getServices();
        try {
            const id = assertConsumerId(consumerId);

            // Step 1: SchemaProvisioningService.provision(id)
            await schemaService.provision(id);

            // Step 2: MaterialProvisioningService.provision(id, { profile, zones })
            await materialService.provision(id, {
                profile: options.profile,
                zones: options.zones,
            });

            // Step 3: ProvisioningStateService.persistSetup(id, { expectReady: true })
            const setupInfo = await stateService.persistSetup(id, { expectReady: true });

            return {
                consumer: id,
                status: 'provisioned',
                schema: `c_${id}`,
                material: {
                    agents: true,
                    harness: '.harness/config.json',
                    manifest: '.harness/manifest.json',
                },
                setup: {
                    ready: setupInfo.setup.ready,
                    updated_at: setupInfo.setup.updatedAt,
                    updatedAt: setupInfo.setup.updatedAt,
                },
            };
        } catch (err) {
            this.handleError(err);
        }
    }

    async getSetup(consumerId: string) {
        const { stateService } = this.getServices();
        try {
            const id = assertConsumerId(consumerId);
            return await stateService.readSetup(id);
        } catch (err) {
            this.handleError(err);
        }
    }

    private handleError(err: unknown): never {
        if (err instanceof HttpException) {
            throw err;
        }

        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code || '';

        if (code === 'CONSUMER_NOT_FOUND' || message.includes('CONSUMER_NOT_FOUND')) {
            throw new NotFoundException({
                type: 'https://eso.dev/errors/not-found',
                title: 'Not Found',
                status: 404,
                code: 'CONSUMER_NOT_FOUND',
                error: 'CONSUMER_NOT_FOUND',
                detail: message,
            });
        }

        if (code === 'SCHEMA_MISMATCH' || err instanceof SchemaMismatchError || message.includes('SCHEMA_MISMATCH')) {
            throw new ConflictException({
                type: 'https://eso.dev/errors/conflict',
                title: 'Conflict',
                status: 409,
                code: 'SCHEMA_MISMATCH',
                error: 'SCHEMA_MISMATCH',
                detail: message,
            });
        }

        if (code === 'ROOT_NOT_FOUND' || message.includes('ROOT_NOT_FOUND')) {
            throw new UnprocessableEntityException({
                type: 'https://eso.dev/errors/unprocessable-entity',
                title: 'Unprocessable Entity',
                status: 422,
                code: 'ROOT_NOT_FOUND',
                error: 'ROOT_NOT_FOUND',
                detail: message,
            });
        }

        if (code === 'MATERIAL_FAILED' || message.includes('MATERIAL_FAILED') || code === 'MATERIALIZE_FAILED') {
            throw new InternalServerErrorException({
                type: 'https://eso.dev/errors/material-failed',
                title: 'Material Failed',
                status: 500,
                code: 'MATERIAL_FAILED',
                error: 'MATERIAL_FAILED',
                detail: message,
            });
        }

        if (code === 'SETUP_INFO_MISSING' || message.includes('SETUP_INFO_MISSING')) {
            throw new InternalServerErrorException({
                type: 'https://eso.dev/errors/setup-info-missing',
                title: 'Setup Info Missing',
                status: 500,
                code: 'SETUP_INFO_MISSING',
                error: 'SETUP_INFO_MISSING',
                detail: message,
            });
        }

        if (code === 'INVALID_CONSUMER_ID' || message.includes('INVALID_CONSUMER_ID')) {
            throw new BadRequestException({
                type: 'https://eso.dev/errors/bad-request',
                status: 400,
                title: 'Bad Request',
                code: 'INVALID_CONSUMER_ID',
                error: 'INVALID_CONSUMER_ID',
                detail: message,
            });
        }

        throw new InternalServerErrorException({
            type: 'https://eso.dev/errors/internal-error',
            title: 'Internal Server Error',
            status: 500,
            code: 'PROVISION_FAILED',
            error: 'PROVISION_FAILED',
            detail: message,
        });
    }
}
