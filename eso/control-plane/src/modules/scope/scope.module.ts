import { Module } from '@nestjs/common';

/**
 * P6 — the scope guard is wired through `ScopeService` (HTTP `/scope/check` + worker write path);
 * the domain rules stay in `domain/scope.ts` so both callers share one implementation.
 */
@Module({})
export class ScopeModule {}
