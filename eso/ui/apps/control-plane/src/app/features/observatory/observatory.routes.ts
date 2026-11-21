import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const OBSERVATORY_ROUTES: Routes = [
    {
        path: '',
        pathMatch: 'full',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/observatory.page.js').then((m) => m.ObservatoryPage),
    },
];
