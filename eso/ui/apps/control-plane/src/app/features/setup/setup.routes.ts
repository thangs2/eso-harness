import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';
import { SetupPage } from './pages/setup.page.js';

export const SETUP_ROUTES: Routes = [
    { path: '', component: SetupPage, canActivate: [authGuard] },
];
