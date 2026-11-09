import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ShellComponent } from '../apps/control-plane/src/app/layout/shell/shell.component.js';
import { APP_ROUTES } from '../apps/control-plane/src/app/routes.js';
import { APP_CONFIG, CONTROL_PLANE_API_CLIENT } from '../apps/control-plane/src/app/core/tokens.js';
import { ControlPlaneApiClient } from '../libs/api-client/client.js';

const API_BASE = 'http://127.0.0.1:8787';

bootstrapApplication(ShellComponent, {
    providers: [
        provideRouter(APP_ROUTES),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: API_BASE, environment: 'development' } },
        {
            provide: CONTROL_PLANE_API_CLIENT,
            useFactory: () =>
                new ControlPlaneApiClient({
                    baseUrl: API_BASE,
                    tokenProvider: () => globalThis.sessionStorage?.getItem('eso.auth') ?? null,
                }),
        },
    ],
}).catch((err: unknown) => console.error(err));
