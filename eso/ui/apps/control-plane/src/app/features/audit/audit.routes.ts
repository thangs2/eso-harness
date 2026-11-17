import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const AUDIT_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/audit.page.js').then((m) => m.AuditPage),
    },
];
