import type { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard.js';
import { OnboardingPage } from './pages/onboarding.page.js';

export const ONBOARDING_ROUTES: Routes = [
    { path: '', component: OnboardingPage, canActivate: [authGuard] },
    { path: ':id', component: OnboardingPage, canActivate: [authGuard] },
];
