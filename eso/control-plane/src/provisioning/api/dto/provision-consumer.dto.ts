import { IsArray, IsObject, IsOptional } from 'class-validator';

export class ProvisionConsumerDto {
    @IsOptional()
    @IsObject()
    profile?: Record<string, unknown>;

    @IsOptional()
    @IsArray()
    zones?: unknown[];
}
