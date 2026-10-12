import { backend } from '@/lib/backend';
import { PageHeading, Placeholder, RowLink, SearchBar, Section, Status, Time } from '@/components/ui';
import type { Overview } from '@/lib/types';

export default async function Servers({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const { q = '', view = '' } = await searchParams;
  const query = q.slice(0, 100);
  const flaggedOnly = view === 'flagged';
  const data = await backend<Overview>(`/api/admin/v2/overview?q=${encodeURIComponent(query)}${flaggedOnly ? '&view=flagged' : ''}`);
  const rows = data.networks;
  const toggleHref = flaggedOnly ? `?q=${encodeURIComponent(query)}` : `?q=${encodeURIComponent(query)}&view=flagged`;
  return <>
    <PageHeading eyebrow="Infrastructure / Network explorer" title="Servers & networks" desc="Each address represents an observed outbound IP, which may contain several servers, proxies or hosts. Public Minecraft reachability is not inferred." />
    <div className="mb-5 explorer-filters">
      <SearchBar defaultValue={query} placeholder="Filter by IP, plugin or node ID" view={flaggedOnly ? 'flagged' : undefined} />
      <a className={`filter-chip ${flaggedOnly ? 'filter-chip-active' : ''}`} href={toggleHref}>{flaggedOnly ? 'Showing flagged only · Clear filter' : 'Show flagged only'}</a>
    </div>
    <Section title={`${flaggedOnly ? data.stats.flaggedNetworks : data.stats.networks} ${flaggedOnly ? 'flagged' : 'observed'} network groups`} subtitle="Transport associations, not proof of common administration.">
      {rows.length ? <>
        <div className="md:hidden explorer-list">
          {rows.map(n => <div key={n.id} className="explorer-row">
            <div className="flex justify-between gap-3 items-start"><span className="monos text-sm"><RowLink href={`/server/${encodeURIComponent(n.id)}`}>{n.observedIp}</RowLink></span><Status value={n.policy.status}/></div>
            <div className="explorer-card-meta"><span>{n.nodes} nodes</span><span className="text-[#75dfa9]">{n.online} online</span></div>
            <div className="flex justify-between items-center gap-3 pt-3 border-t soft-line"><span className="subtle text-xs">Last report <Time at={n.lastSeen}/></span>{n.suspiciousPlugins ? <span className="plugin-tag plugin-suspect">{n.suspiciousPlugins} flagged</span> : <span className="subtle text-xs">No markers</span>}</div>
          </div>)}
        </div>
        <div className="hidden md:block overflow-x-auto"><table className="table w-full"><thead><tr><th>IP address</th><th>Nodes</th><th>Active</th><th>Suspect plugins</th><th>Last observation</th><th>Policy</th></tr></thead><tbody>
          {rows.map(n => <tr key={n.id}><td className="monos"><RowLink href={`/server/${encodeURIComponent(n.id)}`}>{n.observedIp}</RowLink></td><td>{n.nodes}</td><td>{n.online}</td><td>{n.suspiciousPlugins ? <span className="plugin-tag plugin-suspect">{n.suspiciousPlugins} flagged</span> : <span className="subtle">0</span>}</td><td><Time at={n.lastSeen}/></td><td><Status value={n.policy.status}/></td></tr>)}
        </tbody></table></div>
        {rows.length < (flaggedOnly ? data.stats.flaggedNetworks : data.stats.networks) &&
          <p className="subtle text-xs mt-4">Showing the first 2,000 matching entries. Narrow your search to inspect others.</p>}
      </> : <Placeholder>No networks match the current filters.</Placeholder>}
    </Section>
  </>;
}
