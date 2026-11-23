import { ErrorHandler } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { ShellComponent } from '../apps/control-plane/src/app/layout/shell/shell.component.js';
import { APP_ROUTES } from '../apps/control-plane/src/app/routes.js';
import { APP_CONFIG, CONTROL_PLANE_API_CLIENT } from '../apps/control-plane/src/app/core/tokens.js';
import { GlobalErrorHandler } from '../apps/control-plane/src/app/core/error-handler/global-error-handler.js';
import { ControlPlaneApiClient } from '../libs/api-client/client.js';

const API_BASE = 'http://127.0.0.1:8787';

/** Dev-only conveniences (prefilled operator credentials) are gated on the actual host, not a build constant. */
const isLocalHost = (): boolean =>
    typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

bootstrapApplication(ShellComponent, {
    providers: [
        provideRouter(APP_ROUTES),
        provideAnimationsAsync(),
        // BUG-44: without this provider Angular falls back to the default handler and client errors are never reported.
        { provide: ErrorHandler, useClass: GlobalErrorHandler },
        { provide: APP_CONFIG, useValue: { apiBaseUrl: API_BASE, environment: isLocalHost() ? 'development' : 'production' } },
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
