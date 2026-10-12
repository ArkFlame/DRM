export function equalSecret(a: string, b: string): boolean;
export function makeCookie(secret: string, epoch?: number): string;
export function verifyCookie(cookie: string, secret: string, epoch?: number): boolean;
export const sessionTtlSeconds: number;
