export interface ConsumerOption {
    id: string;
    name: string;
    root: string;
    status: string;
}

export interface ProvisioningPreview {
    consumerId: string;
    name: string;
    root: string;
    schemaName: string;
    materialBundle: string[];
}

export interface ProvisioningSuccess {
    consumerId: string;
    status: string;
    schema: string;
    ready: boolean;
    updatedAt: string;
}

export interface ProvisioningError {
    code: string;
    message: string;
    status?: number;
}
