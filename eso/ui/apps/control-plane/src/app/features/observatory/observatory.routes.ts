import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const OBSERVATORY_ROUTES: Routes = [
    {
        path: '',
        pathMatch: 'full',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/observatory.page.js').then((m) => m.ObservatoryPage),
    },
    {
        // Detail belongs to the Observatory master surface: /observatory/requests/:requestId
        path: 'requests/:requestId',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/request-detail.page.js').then((m) => m.RequestDetailPage),
    },
];
