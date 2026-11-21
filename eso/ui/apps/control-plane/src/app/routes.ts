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
        path: 'plugins',
        loadChildren: () => import('./features/plugins/plugins.routes.js').then((m) => m.PLUGINS_ROUTES),
    },
    {
        path: 'hosts',
        loadChildren: () => import('./features/hosts/hosts.routes.js').then((m) => m.HOSTS_ROUTES),
    },
    {
        path: 'consumers',
        loadChildren: () => import('./features/consumers/consumers.routes.js').then((m) => m.CONSUMERS_ROUTES),
    },
    {
        path: 'observatory',
        loadChildren: () => import('./features/observatory/observatory.routes.js').then((m) => m.OBSERVATORY_ROUTES),
    },
    {
        path: 'office',
        loadChildren: () => import('./features/observatory/office.routes.js').then((m) => m.OFFICE_ROUTES),
    },
    {
        path: 'event-graph',
        loadChildren: () => import('./features/observatory/event-graph.routes.js').then((m) => m.EVENT_GRAPH_ROUTES),
    },
    {
        path: 'events',
        canActivate: [authGuard],
        loadComponent: () => import('./features/observatory/pages/event-stream.page.js').then((m) => m.EventStreamPage),
    },
    {
        path: 'requests',
        redirectTo: 'observatory',
        pathMatch: 'full',
    },
    {
        path: 'requests/:requestId',
        canActivate: [authGuard],
        loadComponent: () => import('./features/observatory/pages/request-detail.page.js').then((m) => m.RequestDetailPage),
    },
    {
        path: 'observatory/events',
        redirectTo: 'events',
        pathMatch: 'full',
    },
    {
        path: 'observatory/requests',
        redirectTo: 'observatory',
        pathMatch: 'full',
    },
    {
        path: 'work-overview',
        redirectTo: 'observatory',
        pathMatch: 'full',
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
        loadChildren: () => import('./features/onboarding/onboarding.routes.js').then((m) => m.ONBOARDING_ROUTES),
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
