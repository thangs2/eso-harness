import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';

export const EVENT_GRAPH_ROUTES: Routes = [
    {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/event-graph.page.js').then((m) => m.EventGraphPage),
    },
];
