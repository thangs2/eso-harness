import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const DIAGNOSIS_ROUTES: Routes = [
    {
        path: ':turnId',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/diagnosis.page.js').then((m) => m.DiagnosisPage),
    },
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/diagnosis.page.js').then((m) => m.DiagnosisPage),
    },
];
