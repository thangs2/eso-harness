import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const RISK_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/risk.page.js').then((m) => m.RiskPage),
    },
];
