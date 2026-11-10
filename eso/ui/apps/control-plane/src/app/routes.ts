import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard.js';

export const APP_ROUTES: Routes = [
    {
        path: '',
        redirectTo: 'consumers',
        pathMatch: 'full',
    },
    {
        path: 'login',
        loadChildren: () => import('./features/login/login.routes.js').then((m) => m.LOGIN_ROUTES),
    },
    {
        path: 'consumers',
        loadChildren: () => import('./features/consumers/consumers.routes.js').then((m) => m.CONSUMERS_ROUTES),
    },
    {
        path: 'work-overview',
        loadChildren: () => import('./features/work-overview/work-overview.routes.js').then((m) => m.WORK_OVERVIEW_ROUTES),
    },
    {
        path: 'diagnosis',
        loadChildren: () => import('./features/diagnosis/diagnosis.routes.js').then((m) => m.DIAGNOSIS_ROUTES),
    },
    {
        path: 'declaration',
        loadChildren: () => import('./features/declaration/declaration.routes.js').then((m) => m.DECLARATION_ROUTES),
    },
    {
        path: 'risk',
        loadChildren: () => import('./features/risk/risk.routes.js').then((m) => m.RISK_ROUTES),
    },
    {
        path: 'audit',
        loadChildren: () => import('./features/audit/audit.routes.js').then((m) => m.AUDIT_ROUTES),
    },
    {
        path: 'onboarding',
        loadChildren: () => import('./features/setup/setup.routes.js').then((m) => m.SETUP_ROUTES),
    },
    {
        path: 'setup',
        loadChildren: () => import('./features/setup/setup.routes.js').then((m) => m.SETUP_ROUTES),
    },
    {
        path: '**',
        redirectTo: 'consumers',
    },
];
