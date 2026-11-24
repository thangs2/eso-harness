import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../../core/auth/auth.service.js';
import { AppConfigService } from '../../../core/config/app-config.service.js';

@Component({
    selector: 'eso-login-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="login-shell">
            <mat-card class="login-panel" aria-label="Control plane sign in">
                <p class="eyebrow login-eyebrow">ESO Control Plane</p>
                <mat-card-header>
                    <mat-card-title>Sign in</mat-card-title>
                    <mat-card-subtitle>Use the credential from <code>eso/.env</code> (HTTP Basic).</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    @if (error()) {
                        <p class="form-error" role="alert">{{ error() }}</p>
                    }
                    @if (isDev) {
                        <p class="login-hint">Dev credential: <code>operator</code> / <code>eso-dev-only-token</code> — prefilled by this build.</p>
                    }
                    <form (ngSubmit)="submit()" class="login-form">
                        <mat-form-field appearance="outline">
                            <mat-label>Username</mat-label>
                            <input matInput name="user" [(ngModel)]="user" autocomplete="username" required>
                        </mat-form-field>
                        <mat-form-field appearance="outline">
                            <mat-label>Password</mat-label>
                            <input matInput name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required>
                        </mat-form-field>
                        <button mat-flat-button color="primary" type="submit" [disabled]="loading()" class="login-submit">
                            {{ loading() ? 'Signing in…' : 'Sign in' }}
                        </button>
                    </form>
                </mat-card-content>
            </mat-card>
        </main>
    `,
})
export class LoginPage {
    private readonly auth = inject(AuthService);
    private readonly config = inject(AppConfigService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    private readonly isDev = this.config.environment() === 'development';

    constructor() {
        // A new tab may receive the credential from an already signed-in tab; continue to the
        // requested page instead of asking the operator to type it again.
        void this.auth.ready.then(() => {
            if (this.auth.isAuthenticated()) void this.redirectBack();
        });
    }

    // Local dev convenience only: never ship these defaults in a production config.
    user = this.isDev ? 'operator' : '';
    password = this.isDev ? 'eso-dev-only-token' : '';
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    async submit(): Promise<void> {
        this.error.set(null);
        this.loading.set(true);
        // BUG-10: encoding happens inside the try so a non-Latin-1 credential cannot throw
        // past the finally and leave the button stuck on "Signing in…".
        try {
            const authorization = `Basic ${this.encodeBasic(this.user, this.password)}`;
            const res = await fetch(`${this.config.apiBaseUrl()}/api/v1/auth/me`, {
                headers: { Accept: 'application/json', Authorization: authorization },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                this.error.set(`${body.code || 'AUTH_INVALID'}: ${body.message || 'Sign in failed'}`);
                return;
            }
            this.auth.setAuthorization(authorization);
            // BUG-40: do not leave the password on screen after a successful sign in.
            this.password = '';
            await this.redirectBack();
        } catch {
            this.error.set('AUTH_INVALID: Unable to reach control plane');
        } finally {
            this.loading.set(false);
        }
    }

    private async redirectBack(): Promise<void> {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        await this.router.navigateByUrl(returnUrl && /^\/(?!\/)/.test(returnUrl) ? returnUrl : '/consumers');
    }

    /** UTF-8-safe Base64 for HTTP Basic (btoa alone throws above U+00FF). */
    private encodeBasic(user: string, password: string): string {
        const bytes = new TextEncoder().encode(`${user}:${password}`);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }
}
