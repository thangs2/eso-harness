import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const REQUEST_DETAIL_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/request-detail.page.js').then((m) => m.RequestDetailPage),
    },
];
