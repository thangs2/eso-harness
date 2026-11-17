import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const WORK_OVERVIEW_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/work-overview.page.js').then((m) => m.WorkOverviewPage),
    },
];
