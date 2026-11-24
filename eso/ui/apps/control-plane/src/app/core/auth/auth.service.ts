import { Injectable, signal, computed } from '@angular/core';

/**
 * Authentication Service (Angular 22 Signals).
 * AC-15-1 / FRD-F07: the UI keeps the HTTP Basic credential in sessionStorage
 * (never localStorage, never a server-side session).
 *
 * sessionStorage is per-tab, so a link opened in a new tab would otherwise land on /login even
 * though the browser already signed in. The credential is NOT copied to localStorage: a
 * same-origin `BroadcastChannel` asks an already-authenticated tab for the in-memory header and
 * the new tab keeps it in its own sessionStorage. With no peer tab the handshake times out and
 * the normal login page applies.
 */
const CHANNEL = 'eso.auth.v1';
const HANDSHAKE_MS = 400;

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly _authorization = signal<string | null>(this.read());
    private channel: BroadcastChannel | null = null;
    private resolveReady: (() => void) | null = null;

    /** Resolves once the cross-tab handshake settled (immediately when a credential exists). */
    readonly ready: Promise<void>;

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

    constructor() {
        this.ready = new Promise<void>((resolve) => {
            this.resolveReady = resolve;
            if (this._authorization()) {
                this.openChannel();
                resolve();
                return;
            }
            this.openChannel();
            this.channel?.postMessage({ type: 'request' });
            // No peer tab: fall through to the login page rather than blocking the guard.
            setTimeout(() => resolve(), HANDSHAKE_MS);
        });
    }

    setAuthorization(value: string | null): void {
        try {
            if (value) sessionStorage.setItem('eso.auth', value);
            else sessionStorage.removeItem('eso.auth');
        } catch {
            // Storage can be unavailable (private mode); the in-memory signal still works.
        }
        this._authorization.set(value);
        if (value) this.resolveReady?.();
    }

    setCredential(user: string, password: string): string {
        const value = `Basic ${btoa(`${user}:${password}`)}`;
        this.setAuthorization(value);
        return value;
    }

    clear(): void {
        this.setAuthorization(null);
    }

    private openChannel(): void {
        if (typeof BroadcastChannel === 'undefined') return;
        try {
            this.channel = new BroadcastChannel(CHANNEL);
            this.channel.onmessage = (event: MessageEvent) => {
                const data = event.data as { type?: string; authorization?: string } | null;
                if (!data) return;
                if (data.type === 'request') {
                    const current = this._authorization();
                    if (current) this.channel?.postMessage({ type: 'grant', authorization: current });
                    return;
                }
                if (data.type === 'grant' && !this._authorization()) {
                    const value = String(data.authorization || '');
                    if (value.startsWith('Basic ')) {
                        this.setAuthorization(value);
                        this.resolveReady?.();
                    }
                }
            };
        } catch {
            this.channel = null;
        }
    }

    private read(): string | null {
        try {
            return sessionStorage.getItem('eso.auth');
        } catch {
            return null;
        }
    }
}
