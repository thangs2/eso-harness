import { Injectable, signal, computed } from '@angular/core';

/**
 * Authentication Service (Angular 22 Signals).
 * AC-15-1 / FRD-F07: the UI keeps the HTTP Basic credential in sessionStorage
 * (never localStorage, never a server-side session).
 */
@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private readonly _authorization = signal<string | null>(this.read());

    readonly authorization = this._authorization.asReadonly();
    readonly isAuthenticated = computed(() => Boolean(this._authorization()));

    /** Display name only; the password stays inside the encoded header. */
    readonly user = computed(() => {
        const value = this._authorization();
        if (!value || !value.startsWith('Basic ')) return 'Operator';
        try {
            return atob(value.slice(6)).split(':')[0] || 'Operator';
        } catch {
            return 'Operator';
        }
    });

    setAuthorization(value: string | null): void {
        try {
            if (value) sessionStorage.setItem('eso.auth', value);
            else sessionStorage.removeItem('eso.auth');
        } catch {
            // Storage can be unavailable (private mode); the in-memory signal still works.
        }
        this._authorization.set(value);
    }

    setCredential(user: string, password: string): string {
        const value = `Basic ${btoa(`${user}:${password}`)}`;
        this.setAuthorization(value);
        return value;
    }

    clear(): void {
        this.setAuthorization(null);
    }

    private read(): string | null {
        try {
            return sessionStorage.getItem('eso.auth');
        } catch {
            return null;
        }
    }
}
