import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const DECLARATION_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/declaration.page.js').then((m) => m.DeclarationPage),
    },
];
