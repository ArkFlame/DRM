import { backend } from '@/lib/backend';
import { PageHeading, Placeholder, Presence, RowLink, SearchBar, Section, Time } from '@/components/ui';
import type { Overview } from '@/lib/types';

export default async function Nodes({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const { q = '', view = '' } = await searchParams;
  const query = q.slice(0, 100);
  const flaggedOnly = view === 'flagged';
  const data = await backend<Overview>(`/api/admin/v2/overview?q=${encodeURIComponent(query)}${flaggedOnly ? '&view=flagged' : ''}`);
  const rows = data.nodes;
  const toggleHref = flaggedOnly ? `?q=${encodeURIComponent(query)}` : `?q=${encodeURIComponent(query)}&view=flagged`;
  return <>
    <PageHeading eyebrow="Infrastructure / Node explorer" title="All nodes" desc="A node is a locally generated ID shared among ArkFlame plugins in one Minecraft plugins directory. Its identity is self-reported and not cryptographic proof." />
    <div className="mb-5 explorer-filters">
      <SearchBar placeholder="Node ID, IP, server version or plugin" defaultValue={query} view={flaggedOnly ? 'flagged' : undefined} />
      <a className={`filter-chip ${flaggedOnly ? 'filter-chip-active' : ''}`} href={toggleHref}>{flaggedOnly ? 'Showing flagged only · Clear filter' : 'Show flagged only'}</a>
    </div>
    <Section title={`${flaggedOnly ? data.stats.flaggedNodes : data.stats.nodes} ${flaggedOnly ? 'flagged' : 'observed'} nodes`} subtitle="Review markers are name/filename signals, not proof of unauthorized usage.">
      {rows.length ? <>
        <div className="md:hidden explorer-list">
          {rows.map(n => <div className="explorer-row" key={n.id}>
            <div className="flex justify-between items-start gap-3"><div className="min-w-0"><div className="monos text-sm"><RowLink href={`/node/${n.id}`}>{n.id.slice(0, 12)}…</RowLink></div><div className="monos subtle mt-1 break-all">{n.observedIp}:{n.port}</div></div><Presence online={n.online} /></div>
            <div className="explorer-card-meta"><span>{n.products.length} products</span><span>{n.playerCount} seen players</span><span>{n.uptime.toFixed(1)}% uptime</span></div>
            <div className="flex justify-between items-center gap-3 pt-3 border-t soft-line"><span className="subtle text-xs">Last report <Time at={n.lastSeen} /></span>{n.suspiciousPlugins ? <span className="plugin-tag plugin-suspect">{n.suspiciousPlugins} flagged</span> : <span className="subtle text-xs">No markers</span>}</div>
          </div>)}
        </div>
        <div className="hidden md:block overflow-x-auto"><table className="table w-full"><thead><tr><th>Node</th><th>IP / port</th><th>Product installs</th><th>Players</th><th>Suspect plugins</th><th>Uptime</th><th>Last seen</th><th>Status</th></tr></thead><tbody>
          {rows.map(n => <tr key={n.id}><td className="monos"><RowLink href={`/node/${n.id}`}>{n.id.slice(0, 12)}…</RowLink></td><td className="monos">{n.observedIp}:{n.port}</td><td>{n.products.length}</td><td>{n.playerCount}</td><td>{n.suspiciousPlugins ? <span className="plugin-tag plugin-suspect">{n.suspiciousPlugins} flagged</span> : <span className="subtle">0</span>}</td><td>{n.uptime.toFixed(1)}%</td><td><Time at={n.lastSeen}/></td><td><Presence online={n.online}/></td></tr>)}
        </tbody></table></div>
        {rows.length < (flaggedOnly ? data.stats.flaggedNodes : data.stats.nodes) &&
          <p className="subtle text-xs mt-4">Showing the first 2,000 matching entries. Narrow your search to inspect others.</p>}
      </> : <Placeholder>No nodes match the current filters.</Placeholder>}
    </Section>
  </>;
}
