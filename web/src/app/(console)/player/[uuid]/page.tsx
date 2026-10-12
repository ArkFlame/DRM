import { backend } from '@/lib/backend';
import { DeletePlayer } from '@/components/actions';
import { PageHeading, Pair, Placeholder, Presence, RowLink, Section, Time, Warning } from '@/components/ui';
import type { Player } from '@/lib/types';
import { notFound } from 'next/navigation';
export default async function PlayerDetail({params}:{params:Promise<{uuid:string}>}){
 const {uuid}=await params;let p:Player;try{p=await backend<Player>(`/api/admin/v2/player?id=${encodeURIComponent(uuid)}`)}catch(e){if(e instanceof Error && e.message==='Backend error 404')notFound();throw e;}if(!p)notFound();
 return <><PageHeading eyebrow="Identity / Player profile" title={p.name} desc={p.uuid}><Presence online={p.online}/></PageHeading><div className="mb-5"><Warning>OP means Bukkit operator permission at observation time. It is not verified server ownership. Data may be stale.</Warning></div>
 <div className="grid xl:grid-cols-[1fr_1.3fr] gap-5"><Section title="Profile"><dl className="px-5"><Pair label="Last username">{p.name}</Pair><Pair label="UUID"><span className="monos">{p.uuid}</span></Pair><Pair label="First observed"><Time at={p.firstSeen}/></Pair><Pair label="Last observed"><Time at={p.lastSeen}/></Pair><Pair label="Associated nodes">{p.connections?.length||0}</Pair></dl><div className="px-5 pb-5 pt-4 border-t soft-line"><DeletePlayer uuid={p.uuid}/><p className="mt-2 subtle text-xs">Erases stored profile, node relationships and active presence.</p></div></Section>
 <Section title="Node associations" subtitle="Aggregated opt-in observations; one player can connect to multiple nodes.">{p.connections?.length?<div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>Node / IP</th><th>Operator</th><th>Last seen</th><th>Status</th></tr></thead><tbody>{p.connections.map(n=><tr key={n.nodeId}><td><RowLink href={`/node/${n.nodeId}`}>{n.nodeId.slice(0,8)}…</RowLink><div className="monos subtle">{n.nodeIp}</div></td><td>{n.op?'Yes':'No'}</td><td><Time at={n.lastSeen}/></td><td><Presence online={n.online}/></td></tr>)}</tbody></table></div>:<Placeholder/>}</Section></div></>;
}
