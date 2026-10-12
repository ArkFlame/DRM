export function clientIp(request: Request, trustProxy?: boolean): string;
export function readJson(request: Request, max: number): Promise<{data?: unknown; status?: number; error?: string}>;
