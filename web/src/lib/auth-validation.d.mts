export function matchesConfiguredPassword(candidate: unknown, expected: unknown): boolean;
export function allowedRequestOrigin(req: Request, configuredOrigin: string | undefined, trustProxy?: boolean): boolean;
export function secureCookieForRequest(req: Request, production: boolean, trustProxy?: boolean, override?: boolean): boolean;
