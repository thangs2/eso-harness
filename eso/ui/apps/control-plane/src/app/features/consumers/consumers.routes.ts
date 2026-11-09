import type { Routes } from '@angular/router';
import { ConsumersPage } from './pages/consumers.page.js';
import { authGuard } from '../../core/auth/auth.guard.js';
import { ConsumerDetailPage } from './pages/consumer-detail.page.js';

export const CONSUMERS_ROUTES: Routes = [
    { path: '', component: ConsumersPage, canActivate: [authGuard] },
    { path: ':id', component: ConsumerDetailPage, canActivate: [authGuard] },
];
