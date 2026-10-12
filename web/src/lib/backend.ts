import 'server-only';
import { drmService } from '@/server/service.mjs';
// Internal service call. No HTTP bridge and no administrator token.
export async function backend<T>(path: string, options?: { method?: 'POST'; body?: unknown }): Promise<T> {
  return drmService().query(path, options?.body) as Promise<T>;
}
