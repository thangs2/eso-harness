import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const HOSTS_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/hosts.page.js').then((m) => m.HostsPage),
    },
];
