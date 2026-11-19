import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/auth/auth.service.js';
import { ConsumerProfileService } from '../../core/consumers/consumer-profile.service.js';
import type { ConsumerListResponse } from '../../../../../../libs/api-client/types.js';

const PAGE_LABELS: Record<string, string> = {
    consumers: 'Consumers',
    settings: 'Settings',
    flows: 'Flows',
    plugins: 'Providers',
    architecture: 'Architecture',
    learning: 'Learning',
    work: 'Work',
    diagnosis: 'Diagnosis',
    declaration: 'Declaration',
    risk: 'Risk',
    audit: 'Audit',
    hosts: 'Hosts',
    plugins_registry: 'Registry',
};

@Component({
    selector: 'eso-shell',
    standalone: true,
    imports: [RouterOutlet, RouterLink, RouterLinkActive, MatMenuModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (auth.isAuthenticated()) {
            <a class="skip-link" href="#eso-main">Skip to content</a>
            <div class="eso-layout">
                <header class="eso-header" role="banner">
                    <button type="button" class="menu-toggle" aria-label="Open navigation" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">☰</button>
                    <a class="brand" routerLink="/consumers" aria-label="ESO Control Plane home">
                        <span class="brand-mark">ESO</span>
                        <span class="brand-text">Control Plane</span>
                    </a>

                    <div class="header-context" aria-label="Current context">
                        @if (consumerId(); as id) {
                            <label class="consumer-switcher">
                                <span class="context-label">Consumer</span>
                                <select [value]="id" (change)="switchConsumer($event)" aria-label="Switch consumer">
                                    @for (item of consumers(); track item.id) {
                                        <option [value]="item.id" [selected]="item.id === id">{{ item.name || item.id }}</option>
                                    }
                                    @if (!consumers().some((item) => item.id === id)) { <option [value]="id" selected>{{ id }}</option> }
                                </select>
                            </label>
                            <span class="context-sep" aria-hidden="true">/</span>
                            <span class="context-page">{{ pageLabel() }}</span>
                            <span class="status-chip" [class.status-chip-warn]="activeConsumer()?.status !== 'ready'">
                                <span class="status-dot" aria-hidden="true"></span>{{ activeConsumer()?.status || 'loading' }}
                            </span>
                        } @else {
                            <span class="context-page">{{ pageLabel() }}</span>
                            <span class="status-chip"><span class="status-dot" aria-hidden="true"></span>local</span>
                        }
                    </div>

                    <div class="header-actions">
                        <button type="button" class="command-trigger" (click)="paletteOpen.set(true)" aria-label="Open command palette">
                            <span>Search</span><kbd>⌘K</kbd>
                        </button>
                        <a routerLink="/consumers" class="header-action">All consumers</a>
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
                    </div>
                </header>

                <div class="app-body">
                    @if (menuOpen()) { <button type="button" class="sidebar-overlay" aria-label="Close navigation" (click)="menuOpen.set(false)"></button> }
                    <aside class="app-sidebar" [class.open]="menuOpen()" aria-label="Application navigation">
                        <nav class="side-nav" (click)="menuOpen.set(false)">
                            <p class="side-group">Operate</p>
                            <a routerLink="/consumers" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="side-link">Consumers</a>
                            <a routerLink="/work-overview" class="side-link" [class.active]="onWork()">Work overview</a>
                            <a routerLink="/diagnosis" routerLinkActive="active" class="side-link">Diagnosis</a>

                            @if (consumerId(); as id) {
                                <p class="side-group side-group-consumer">Consumer <span>{{ id }}</span></p>
                                <a [routerLink]="['/consumers', id]" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="side-link">Overview</a>
                                <a [routerLink]="['/consumers', id, 'flows']" routerLinkActive="active" class="side-link">Flows</a>
                                <a [routerLink]="['/consumers', id, 'settings']" routerLinkActive="active" class="side-link">Settings</a>
                                <a [routerLink]="['/consumers', id, 'plugins']" routerLinkActive="active" class="side-link">Providers</a>
                                <a [routerLink]="['/consumers', id, 'architecture']" routerLinkActive="active" class="side-link">Architecture</a>
                                <a [routerLink]="['/consumers', id, 'learning']" routerLinkActive="active" class="side-link">Learning</a>
                                <a [routerLink]="['/work-overview']" [queryParams]="{ project: id }" class="side-link" [class.active]="onWork()">Work</a>
                            }

                            <p class="side-group">Governance</p>
                            <a routerLink="/declaration" routerLinkActive="active" class="side-link">Declaration</a>
                            <a routerLink="/risk" routerLinkActive="active" class="side-link">Risk</a>
                            <a routerLink="/audit" routerLinkActive="active" class="side-link">Audit</a>

                            <p class="side-group">System</p>
                            <a routerLink="/hosts" routerLinkActive="active" class="side-link">Hosts</a>
                            <a routerLink="/plugins" routerLinkActive="active" class="side-link">Registry</a>
                        </nav>
                        <div class="side-foot">
                            <span class="side-foot-title">ESO sidecar</span>
                            <span class="side-foot-text">Config · evidence · audit</span>
                        </div>
                    </aside>
                    <main id="eso-main" class="eso-content" role="main" tabindex="-1">
                        <router-outlet></router-outlet>
                    </main>
                </div>
                @if (paletteOpen()) {
                    <div class="palette-backdrop" (click)="paletteOpen.set(false)">
                        <section class="palette" role="dialog" aria-modal="true" aria-label="Command palette" (click)="$event.stopPropagation()">
                            <input class="palette-input" autofocus type="search" placeholder="Search pages or consumers…" [value]="paletteQuery()" (input)="paletteQuery.set($any($event.target).value)" (keydown.escape)="paletteOpen.set(false)" aria-label="Search pages or consumers">
                            <div class="palette-results">
                                @for (item of paletteResults(); track item.path) {
                                    <button type="button" class="palette-item" (click)="go(item.path)">
                                        <span>{{ item.label }}</span><small>{{ item.group }}</small>
                                    </button>
                                }
                                @if (paletteResults().length === 0) { <p class="palette-empty">No matching page.</p> }
                            </div>
                            <footer class="palette-foot">Enter to open · Esc to close</footer>
                        </section>
                    </div>
                }
            </div>
        } @else {
            <router-outlet></router-outlet>
        }
    `,
    styles: [`
        :host { display: block; }
        .eso-layout { min-height: 100vh; display: flex; flex-direction: column; }
        .skip-link { position: fixed; left: var(--space-4); top: -100px; z-index: 100; background: var(--brand); color: var(--brand-ink); padding: var(--space-2) var(--space-4); border-radius: var(--radius-sm); font-weight: 700; text-decoration: none; }
        .skip-link:focus { top: var(--space-3); }
        .eso-header { position: sticky; top: 0; z-index: 20; min-height: var(--header-h); display: flex; align-items: center; gap: var(--space-4); padding: 0 var(--space-5); background: #070d17; border-bottom: 1px solid #1a2a40; color: #dbeafe; }
        .brand { display: inline-flex; align-items: baseline; gap: var(--space-2); color: #eaf4f6; text-decoration: none; white-space: nowrap; min-width: 210px; }
        .brand-mark { font-weight: 800; letter-spacing: .12em; font-size: var(--text-sm); color: #22d3ee; }
        .brand-text { font-weight: 700; letter-spacing: .02em; font-size: var(--text-sm); }
        .header-context { display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1; }
        .consumer-switcher { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .context-label { color: #7f93a8; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
        .consumer-switcher select { appearance: none; background: #0f1b2b; color: #e6edf3; border: 1px solid #2a4058; border-radius: var(--radius-sm); padding: 5px 26px 5px 8px; font: inherit; font-size: var(--text-xs); max-width: 180px; cursor: pointer; background-image: linear-gradient(45deg, transparent 50%, #8fa3b8 50%), linear-gradient(135deg, #8fa3b8 50%, transparent 50%); background-position: calc(100% - 12px) 50%, calc(100% - 8px) 50%; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; }
        .consumer-switcher select:focus-visible { outline: 2px solid #22d3ee; outline-offset: 1px; }
        .context-sep { color: #3b5168; }
        .context-page { color: #c8d6e5; font-size: var(--text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .status-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #2a4058; background: #0f1b2b; color: #8fa3b8; border-radius: 999px; padding: 3px 8px; font-size: 10px; text-transform: lowercase; white-space: nowrap; }
        .status-chip-warn { border-color: #7a5a1e; color: #f5c76b; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #6ee7b7; }
        .status-chip-warn .status-dot { background: #f5c76b; }
        .header-actions { display: flex; align-items: center; gap: var(--space-3); }
        .header-action { color: #9fb3c8; text-decoration: none; font-size: var(--text-xs); padding: 6px 8px; border-radius: var(--radius-sm); }
        .header-action:hover { background: #142235; color: #fff; }
        .account { display: flex; align-items: center; }
        .account-trigger { display: inline-flex; align-items: center; gap: var(--space-2); border: 1px solid rgba(207,227,232,.28); background: rgba(255,255,255,.06); color: #eaf4f6; border-radius: 999px; padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1); font: inherit; font-size: var(--text-xs); cursor: pointer; }
        .account-trigger:hover, .account-trigger[aria-expanded="true"] { background: rgba(255,255,255,.14); }
        .avatar { width: 28px; height: 28px; display: inline-grid; place-items: center; border-radius: 50%; background: #7dd3c7; color: #063137; font-weight: 800; font-size: var(--text-xs); }
        .account-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .account-caret { opacity: .7; }
        .app-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
        .app-sidebar { position: sticky; top: var(--header-h); align-self: start; min-height: calc(100vh - var(--header-h)); background: #0b1220; border-right: 1px solid #1a2a40; padding: var(--space-4) var(--space-3); display: flex; flex-direction: column; gap: var(--space-4); }
        .side-nav { display: grid; gap: 2px; }
        .side-group { margin: var(--space-3) 0 var(--space-1); padding: 0 var(--space-2); color: #7f93a8; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
        .side-group:first-child { margin-top: 0; }
        .side-group-consumer { display: flex; justify-content: space-between; gap: var(--space-2); color: #9fb3c8; }
        .side-group-consumer span { color: #22d3ee; text-transform: none; letter-spacing: 0; font-size: 10px; }
        .side-link { display: flex; align-items: center; min-height: 32px; padding: 0 var(--space-2); border-left: 2px solid transparent; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: #c8d6e5; text-decoration: none; font-size: 13px; }
        .side-link:hover { background: #142235; color: #fff; }
        .side-link.active { background: #10283a; border-left-color: #22d3ee; color: #22d3ee; font-weight: 600; }
        .side-foot { margin-top: auto; padding: var(--space-3) var(--space-2) 0; border-top: 1px solid #1a2a40; display: grid; gap: 2px; }
        .side-foot-title { color: #c8d6e5; font-size: 11px; font-weight: 700; }
        .side-foot-text { color: #7f93a8; font-size: 10px; }
        .eso-content { width: 100%; max-width: none; margin: 0; padding: var(--space-5); }
        .menu-toggle { display: none; border: 1px solid #2a4058; background: #0f1b2b; color: #dbeafe; border-radius: var(--radius-sm); width: 36px; height: 36px; font-size: 18px; cursor: pointer; }
        .sidebar-overlay { display: none; }
        .command-trigger { display: inline-flex; align-items: center; gap: var(--space-2); border: 1px solid #2a4058; background: #0f1b2b; color: #8fa3b8; border-radius: var(--radius-sm); padding: 5px 8px; font: inherit; font-size: var(--text-xs); cursor: pointer; }
        .command-trigger kbd { border: 1px solid #2a4058; border-radius: 4px; padding: 0 4px; font-size: 10px; color: #c8d6e5; }
        .command-trigger:hover { border-color: #3b5168; color: #e6edf3; }
        .palette-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(2, 6, 12, .62); display: grid; place-items: start center; padding-top: 14vh; }
        .palette { width: min(560px, calc(100vw - 32px)); background: #0f1a2b; border: 1px solid #2a4058; border-radius: var(--radius-lg); box-shadow: 0 24px 80px rgba(0,0,0,.5); overflow: hidden; }
        .palette-input { width: 100%; border: 0; border-bottom: 1px solid #223247; background: #0b1220; color: #e6edf3; padding: var(--space-4); font: inherit; font-size: var(--text-md); outline: none; }
        .palette-input::placeholder { color: #7f93a8; }
        .palette-results { max-height: 340px; overflow: auto; padding: var(--space-2); }
        .palette-item { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); border: 0; background: transparent; color: #e6edf3; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); text-align: left; cursor: pointer; }
        .palette-item:hover, .palette-item:focus-visible { background: #142235; outline: none; }
        .palette-item small { color: #7f93a8; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
        .palette-empty { margin: 0; padding: var(--space-3); color: #7f93a8; font-size: var(--text-sm); }
        .palette-foot { border-top: 1px solid #223247; padding: var(--space-2) var(--space-4); color: #7f93a8; font-size: 10px; }
        @media (max-width: 1100px) {
            .brand { min-width: 0; }
            .header-action { display: none; }
            .header-context { justify-content: flex-end; }
        }
        @media (max-width: 900px) {
            .eso-header { padding: 0 var(--space-3); gap: var(--space-2); }
            .menu-toggle { display: inline-grid; place-items: center; }
            .app-body { grid-template-columns: 1fr; }
            .app-sidebar { position: fixed; z-index: 30; top: var(--header-h); left: 0; width: min(300px, 86vw); transform: translateX(-105%); transition: transform .18s ease; min-height: calc(100vh - var(--header-h)); }
            .app-sidebar.open { transform: translateX(0); }
            .sidebar-overlay { display: block; position: fixed; inset: var(--header-h) 0 0; z-index: 25; border: 0; background: rgba(0,0,0,.45); }
            .eso-content { padding: var(--space-4) var(--space-3); }
            .context-label, .context-sep, .status-chip { display: none; }
            .consumer-switcher select { max-width: 140px; }
            .account-name { display: none; }
        }
        @media (max-width: 560px) {
            .brand-text { display: none; }
            .header-context { display: none; }
        }
    `],
})
export class ShellComponent {
    readonly auth = inject(AuthService);
    private readonly router = inject(Router);
    private readonly profiles = inject(ConsumerProfileService);
    private readonly url = signal(this.router.url);
    readonly menuOpen = signal(false);
    readonly consumers = signal<ConsumerListResponse['items']>([]);

    readonly initials = computed(() => this.auth.user().slice(0, 2).toUpperCase());
    readonly consumerId = computed(() => {
        const match = /^\/consumers\/([^/?]+)/.exec(this.url());
        if (match?.[1] && match[1] !== '') return match[1];
        const query = this.url().split('?')[1] || '';
        return this.onWork() ? new URLSearchParams(query).get('project') : null;
    });
    readonly onWork = computed(() => this.url().startsWith('/work-overview'));
    readonly activeConsumer = computed(() => this.consumers().find((item) => item.id === this.consumerId()) ?? null);
    readonly paletteOpen = signal(false);
    readonly paletteQuery = signal('');
    readonly paletteResults = computed(() => {
        const query = this.paletteQuery().trim().toLowerCase();
        const pages = [
            { label: 'Consumers', path: '/consumers', group: 'Operate' },
            { label: 'Work overview', path: '/work-overview', group: 'Operate' },
            { label: 'Diagnosis', path: '/diagnosis', group: 'Operate' },
            { label: 'Declaration', path: '/declaration', group: 'Governance' },
            { label: 'Risk', path: '/risk', group: 'Governance' },
            { label: 'Audit', path: '/audit', group: 'Governance' },
            { label: 'Hosts', path: '/hosts', group: 'System' },
            { label: 'Registry', path: '/plugins', group: 'System' },
        ];
        const id = this.consumerId();
        const consumerPages = id
            ? [
                { label: 'Consumer overview', path: `/consumers/${id}`, group: 'Consumer' },
                { label: 'Settings', path: `/consumers/${id}/settings`, group: 'Consumer' },
                { label: 'Flows', path: `/consumers/${id}/flows`, group: 'Consumer' },
                { label: 'Providers', path: `/consumers/${id}/plugins`, group: 'Consumer' },
                { label: 'Architecture', path: `/consumers/${id}/architecture`, group: 'Consumer' },
                { label: 'Learning', path: `/consumers/${id}/learning`, group: 'Consumer' },
            ]
            : [];
        const consumers = this.consumers().map((item) => ({ label: `Consumer · ${item.name || item.id}`, path: `/consumers/${item.id}`, group: 'Consumers' }));
        const all = [...consumerPages, ...pages, ...consumers];
        return (query ? all.filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(query)) : all).slice(0, 12);
    });
    readonly pageLabel = computed(() => {
        const parts = this.url().split('?')[0].split('/').filter(Boolean);
        const last = parts[parts.length - 1] || 'consumers';
        if (parts.length === 1 && last === 'consumers') return 'Consumers';
        return PAGE_LABELS[last] ?? last;
    });

    constructor() {
        this.loadConsumers();
        this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
            this.url.set((event as NavigationEnd).urlAfterRedirects);
            this.menuOpen.set(false);
        });
    }

    switchConsumer(event: Event): void {
        const id = (event.target as HTMLSelectElement).value;
        if (id) void this.router.navigate(['/consumers', id]);
    }

    private loadConsumers(): void {
        this.profiles.list().then((result) => this.consumers.set(result.items ?? [])).catch(() => this.consumers.set([]));
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.paletteOpen.set(true);
        }
    }

    go(path: string): void {
        this.paletteOpen.set(false);
        this.paletteQuery.set('');
        void this.router.navigateByUrl(path);
    }

    logout(): void {
        this.auth.clear();
        void this.router.navigateByUrl('/login');
    }
}
