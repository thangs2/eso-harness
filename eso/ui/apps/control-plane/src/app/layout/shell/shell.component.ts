import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/auth/auth.service.js';

@Component({
    selector: 'eso-shell',
    standalone: true,
    imports: [RouterOutlet, RouterLink, RouterLinkActive, MatMenuModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (auth.isAuthenticated()) {
            <div class="eso-layout">
                <header class="eso-header" role="banner">
                    <a class="brand" routerLink="/consumers" aria-label="ESO Control Plane home">
                        <span class="brand-mark">ESO</span>
                        <span class="brand-text">Control Plane</span>
                    </a>
                    <nav class="eso-nav" aria-label="Main Navigation">
                        <a routerLink="/consumers" routerLinkActive="active" class="nav-link">Consumers</a>
                        <a routerLink="/onboarding" routerLinkActive="active" class="nav-link">Setup</a>
                        <a routerLink="/work-overview" routerLinkActive="active" class="nav-link">Work overview</a>
                        <a routerLink="/diagnosis" routerLinkActive="active" class="nav-link">Diagnosis</a>
                        <a routerLink="/declaration" routerLinkActive="active" class="nav-link">Declaration</a>
                        <a routerLink="/risk" routerLinkActive="active" class="nav-link">Risk</a>
                        <a routerLink="/audit" routerLinkActive="active" class="nav-link">Audit</a>
                    </nav>
                    <div class="account">
                        <button
                            type="button"
                            class="account-trigger"
                            [matMenuTriggerFor]="accountMenu"
                            aria-label="Account menu"
                        >
                            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
                            <span class="account-name">{{ auth.user() }}</span>
                            <span class="account-caret" aria-hidden="true">▾</span>
                        </button>
                        <mat-menu #accountMenu="matMenu" xPosition="before">
                            <button mat-menu-item type="button" (click)="logout()">Logout</button>
                        </mat-menu>
                    </div>
                </header>
                <main class="eso-content" role="main">
                    <router-outlet></router-outlet>
                </main>
            </div>
        } @else {
            <router-outlet></router-outlet>
        }
    `,
})
export class ShellComponent {
    readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    readonly initials = computed(() => this.auth.user().slice(0, 2).toUpperCase());

    logout(): void {
        this.auth.clear();
        void this.router.navigateByUrl('/login');
    }
}
