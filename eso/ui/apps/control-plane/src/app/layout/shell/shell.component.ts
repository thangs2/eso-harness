import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
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
                    <button type="button" class="menu-toggle" aria-label="Open navigation" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">☰</button>
                    <a class="brand" routerLink="/consumers" aria-label="ESO Control Plane home">
                        <span class="brand-mark">ESO</span>
                        <span class="brand-text">Control Plane</span>
                    </a>
                    <div class="account">
                        <button type="button" class="account-trigger" [matMenuTriggerFor]="accountMenu" aria-label="Account menu">
                            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
                            <span class="account-name">{{ auth.user() }}</span>
                            <span class="account-caret" aria-hidden="true">▾</span>
                        </button>
                        <mat-menu #accountMenu="matMenu" xPosition="before">
                            <button mat-menu-item type="button" (click)="logout()">Logout</button>
                        </mat-menu>
                    </div>
                </header>
                <div class="app-body">
                    @if (menuOpen()) { <button type="button" class="sidebar-overlay" aria-label="Close navigation" (click)="menuOpen.set(false)"></button> }
                    <aside class="app-sidebar" [class.open]="menuOpen()" aria-label="Application navigation">
                        <nav class="side-nav" (click)="menuOpen.set(false)">
                            <p class="side-group">Workspace</p>
                            <a routerLink="/consumers" routerLinkActive="active" class="side-link">Consumers</a>
                            <a routerLink="/work-overview" class="side-link" [class.active]="onWork() && !consumerId()">Work overview</a>
                            <a routerLink="/diagnosis" routerLinkActive="active" class="side-link">Diagnosis</a>

                            @if (consumerId(); as id) {
                                <p class="side-group">Consumer · {{ id }}</p>
                                <a [routerLink]="['/consumers', id]" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="side-link">Overview</a>
                                <a [routerLink]="['/consumers', id, 'settings']" routerLinkActive="active" class="side-link">Settings</a>
                                <a [routerLink]="['/consumers', id, 'flows']" routerLinkActive="active" class="side-link">Flows</a>
                                <a [routerLink]="['/consumers', id, 'plugins']" routerLinkActive="active" class="side-link">Providers</a>
                                <a [routerLink]="['/consumers', id, 'architecture']" routerLinkActive="active" class="side-link">Architecture</a>
                                <a [routerLink]="['/work-overview']" [queryParams]="{ project: id }" class="side-link" [class.active]="onWork() && consumerId() === id">Work</a>
                            }

                            <p class="side-group">Governance</p>
                            <a routerLink="/declaration" routerLinkActive="active" class="side-link">Declaration</a>
                            <a routerLink="/risk" routerLinkActive="active" class="side-link">Risk</a>
                            <a routerLink="/audit" routerLinkActive="active" class="side-link">Audit</a>

                            <p class="side-group">System</p>
                            <a routerLink="/hosts" routerLinkActive="active" class="side-link">Hosts</a>
                            <a routerLink="/plugins" routerLinkActive="active" class="side-link">Registry</a>
                        </nav>
                    </aside>
                    <main class="eso-content" role="main">
                        <router-outlet></router-outlet>
                    </main>
                </div>
            </div>
        } @else {
            <router-outlet></router-outlet>
        }
    `,
})
export class ShellComponent {
    readonly auth = inject(AuthService);
    private readonly router = inject(Router);
    private readonly url = signal(this.router.url);
    readonly menuOpen = signal(false);

    readonly initials = computed(() => this.auth.user().slice(0, 2).toUpperCase());
    readonly consumerId = computed(() => {
        const match = /^\/consumers\/([^/?]+)/.exec(this.url());
        if (match?.[1]) return match[1];
        const query = this.url().split('?')[1] || '';
        return this.onWork() ? new URLSearchParams(query).get('project') : null;
    });
    readonly onWork = computed(() => this.url().startsWith('/work-overview'));

    constructor() {
        this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
            this.url.set((event as NavigationEnd).urlAfterRedirects);
            this.menuOpen.set(false);
        });
    }

    logout(): void {
        this.auth.clear();
        void this.router.navigateByUrl('/login');
    }
}
