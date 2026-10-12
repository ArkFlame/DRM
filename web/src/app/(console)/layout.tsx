import { requireAuth } from '@/lib/auth';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function ConsoleLayout({children}:{children:React.ReactNode}){await requireAuth();return <Shell>{children}</Shell>}
