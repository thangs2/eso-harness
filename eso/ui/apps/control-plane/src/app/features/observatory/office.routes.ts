import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const OFFICE_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/office.page.js').then((m) => m.OfficePage),
    },
];
