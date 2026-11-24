import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from './auth.service.js';

/**
 * Functional Route Guard (Angular 22)
 * SKILL.md §7: Route guards are UX convenience, NOT authorization.
 * The API backend remains the single source of truth for authorization.
 *
 * `auth.ready` lets a freshly opened tab receive the credential from an already signed-in
 * same-origin tab before deciding to redirect to /login.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    await authService.ready;

    if (authService.isAuthenticated()) {
        return true;
    }

    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
