/**
 * Host-owned credentials for real adapters.
 *
 * ESO never stores or receives these values. Precedence: explicit host option → OS keychain →
 * environment. The result carries only source + secret; callers must never put it in evidence.
 */
export interface CredentialRead {
    secret: string | null;
}

export interface HostCredentialOptions {
    explicit?: string | null;
    env?: Record<string, string | undefined>;
    envKeys?: string[];
    service?: string;
    keychainRead?: (service: string) => string | null;
}

export interface HostCredentialResult {
    source: 'explicit' | 'keychain' | 'env' | 'none';
    secret: string | null;
}

export function resolveHostCredential(options: HostCredentialOptions = {}): HostCredentialResult {
    const explicit = String(options.explicit ?? '').trim();
    if (explicit) return { source: 'explicit', secret: explicit };

    const service = String(options.service ?? '').trim();
    if (service && options.keychainRead) {
        try {
            const secret = String(options.keychainRead(service) ?? '').trim();
            if (secret) return { source: 'keychain', secret };
        } catch {
            // keychain unavailable — fall through to env
        }
    }

    const env = options.env ?? {};
    for (const key of options.envKeys ?? []) {
        const value = String(env[key] ?? '').trim();
        if (value) return { source: 'env', secret: value };
    }
    return { source: 'none', secret: null };
}
