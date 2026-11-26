import type { Routes } from '@angular/router';
import { ConsumersPage } from './pages/consumers.page.js';
import { authGuard } from '../../core/auth/auth.guard.js';
import { ConsumerDetailPage } from './pages/consumer-detail.page.js';
import { ConsumerSettingsPage } from './pages/consumer-settings.page.js';


export const CONSUMERS_ROUTES: Routes = [
    { path: '', component: ConsumersPage, canActivate: [authGuard] },
    { path: ':id/settings', component: ConsumerSettingsPage, canActivate: [authGuard] },
    { path: ':id/flows', loadComponent: () => import('./pages/flows.page.js').then((m) => m.FlowsPage), canActivate: [authGuard] },
    { path: ':id/plugins', loadComponent: () => import('./pages/consumer-plugins.page.js').then((m) => m.ConsumerPluginsPage), canActivate: [authGuard] },
    { path: ':id/reconciliation', loadComponent: () => import('./pages/consumer-reconciliation.page.js').then((m) => m.ConsumerReconciliationPage), canActivate: [authGuard] },
    { path: ':id/architecture', loadComponent: () => import('./pages/architecture.page.js').then((m) => m.ArchitecturePage), canActivate: [authGuard] },
    { path: ':id/learning', loadComponent: () => import('./pages/learning.page.js').then((m) => m.LearningPage), canActivate: [authGuard] },
    { path: ':id', component: ConsumerDetailPage, canActivate: [authGuard] },
];
