import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service.js';
import { AppConfigService } from '../../core/config/app-config.service.js';

@Component({
    selector: 'eso-login-page',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <section class="panel login-panel" aria-label="Đăng nhập control plane">
            <p class="eyebrow">Control Plane</p>
            <h1>Đăng nhập</h1>
            <p class="subtitle">Dùng credential trong <code>eso/.env</code> (HTTP Basic).</p>
            @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
            }
            <form (ngSubmit)="submit()">
                <label>Tài khoản
                    <input name="user" [(ngModel)]="user" autocomplete="username" required>
                </label>
                <label>Mật khẩu
                    <input name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required>
                </label>
                <button class="btn-primary" type="submit" [disabled]="loading()">Đăng nhập</button>
            </form>
        </section>
    `,
})
export class LoginPage {
    private readonly auth = inject(AuthService);
    private readonly config = inject(AppConfigService);
    private readonly router = inject(Router);

    user = '';
    password = '';
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);

    async submit(): Promise<void> {
        this.error.set(null);
        this.loading.set(true);
        const authorization = `Basic ${btoa(`${this.user}:${this.password}`)}`;
        try {
            const res = await fetch(`${this.config.apiBaseUrl()}/api/v1/auth/me`, {
                headers: { Accept: 'application/json', Authorization: authorization },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                this.error.set(`${body.code || 'AUTH_INVALID'}: ${body.message || 'Đăng nhập thất bại'}`);
                return;
            }
            this.auth.setAuthorization(authorization);
            await this.router.navigateByUrl('/consumers');
        } catch {
            this.error.set('AUTH_INVALID: Không kết nối được control plane');
        } finally {
            this.loading.set(false);
        }
    }
}
