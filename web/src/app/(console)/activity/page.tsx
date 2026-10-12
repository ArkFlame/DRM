import { backend } from '@/lib/backend';
import { PageHeading, Placeholder, Section, Status, Time } from '@/components/ui';
import type { AuditEntry } from '@/lib/types';
export default async function ActivityPage(){
 const [a,b]=await Promise.all([backend<AuditEntry[]>('/api/admin/v2/audit'),backend<AuditEntry[]>('/api/admin/audit')]);
 const logs=[...a,...b].sort((x,y)=>y.at.localeCompare(x.at)).slice(0,500);
 return <><PageHeading eyebrow="Operations / Audit trail" title="Administrative activity" desc="A record of explicit advisory policy and installation review changes. Routine heartbeats are not recorded as separate audit entries."/>
 <Section title="Recent administrative changes" subtitle={`${logs.length} latest decisions`}>{logs.length?<div className="overflow-x-auto"><table className="table"><thead><tr><th>Timestamp</th><th>Scope / entity</th><th>Decision</th><th>Reason</th></tr></thead><tbody>{logs.map((r,i)=><tr key={`${r.at}-${i}`}><td><Time at={r.at}/></td><td><div className="text-xs font-bold">{r.scope || r.productId || 'Installation'}</div><div className="monos subtle">{r.id||r.installationId}</div></td><td><Status value={r.status}/></td><td className="text-[#b1bcc9] text-xs max-w-xs break-words">{r.reason}</td></tr>)}</tbody></table></div>:<Placeholder>No manual changes recorded yet.</Placeholder>}</Section></>;
}
