import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';
import { PluginsPage } from './pages/plugins.page.js';

export const PLUGINS_ROUTES: Routes = [
    { path: '', component: PluginsPage, canActivate: [authGuard] },
];
