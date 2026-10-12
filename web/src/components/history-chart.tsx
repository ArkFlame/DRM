'use client';

import { useMemo, useState } from 'react';
import type { HistoryPoint } from '@/lib/types';

type Series = 'players' | 'servers';
const W = 1000, H = 300, LEFT = 58, RIGHT = 939, TOP = 28, BOTTOM = 246;
const colors: Record<Series, string> = { players: '#87aaff', servers: '#65e4af' };
const keys: Series[] = ['players', 'servers'];

// Two named axes prevent low server counts disappearing under large player populations.
// Each series is plotted against its own labeled scale; missing telemetry is never zero-filled.
export function HistoryChart({ history }: { history: HistoryPoint[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const indexes = useMemo(() => history.flatMap((p, i) => p.players !== null || p.servers !== null ? [i] : []), [history]);
  const latest = indexes[indexes.length - 1] ?? -1;
  const focusIndex = selected ?? latest;
  const focus = focusIndex < 0 ? undefined : history[focusIndex];
  const max: Record<Series, number> = {
    players: Math.max(1, ...history.map(h => h.players ?? 0)),
    servers: Math.max(1, ...history.map(h => h.servers ?? 0)),
  };
  const x = (i: number) => LEFT + i * (RIGHT - LEFT) / Math.max(1, history.length - 1);
  const y = (key: Series, value: number) => BOTTOM - value / max[key] * (BOTTOM - TOP);
  const paths = useMemo(() => {
    const build = (key: Series) => {
      const segments: string[] = [], areas: string[] = [], singletons: { cx: number; cy: number }[] = [];
      let part: { index: number; value: number }[] = [];
      const flush = () => {
        if (part.length > 1) {
          const line = part.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.index).toFixed(2)},${y(key, pt.value).toFixed(2)}`).join(' ');
          segments.push(line);
          areas.push(`${line} L${x(part[part.length - 1].index)},${BOTTOM} L${x(part[0].index)},${BOTTOM} Z`);
        } else if (part.length === 1) {
          singletons.push({ cx: x(part[0].index), cy: y(key, part[0].value) });
        }
        part = [];
      };
      history.forEach((point, index) => {
        const value = point[key];
        if (value === null) flush(); else part.push({ index, value });
      });
      flush();
      return { segments, areas, singletons };
    };
    return { players: build('players'), servers: build('servers') };
  }, [history, max.players, max.servers]);
  const label = (time: number) => new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const nearestObserved = (at: number) => indexes.reduce((best, index) => Math.abs(index - at) < Math.abs(best - at) ? index : best, indexes[0]);
  const move = (clientX: number, target: SVGSVGElement) => {
    const bounds = target.getBoundingClientRect();
    const index = Math.max(0, Math.min(history.length - 1, Math.round(((clientX - bounds.left) / bounds.width * W - LEFT) / (RIGHT - LEFT) * (history.length - 1))));
    if (indexes.length) setSelected(nearestObserved(index));
  };
  const step = (direction: number) => {
    if (!indexes.length) return;
    const current = indexes.indexOf(focusIndex);
    setSelected(indexes[Math.max(0, Math.min(indexes.length - 1, current + direction))]);
  };
  return <div className="chart-content">
    <div className="chart-summary" aria-live="polite">
      <div className="chart-stat"><span className="chart-stat-label"><span className="chart-dot chart-dot-player"/>Unique players online <small>left axis</small></span><strong className="chart-stat-number text-[#a8bfff]">{focus?.players ?? '—'}</strong></div>
      <div className="chart-stat"><span className="chart-stat-label"><span className="chart-dot chart-dot-server"/>Servers online <small>right axis</small></span><strong className="chart-stat-number text-[#78e5b4]">{focus?.servers ?? '—'}</strong></div>
      <div className="chart-sample"><span>{focus ? `${label(focus.time)} UTC` : 'No observations'}</span><small>{indexes.length} of {history.length} intervals observed</small></div>
    </div>
    {indexes.length ? <div className="chart-viewport" role="region" aria-label="Scrollable 24-hour chart"><svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="24-hour unique online player counts on the left axis and server counts on the right axis, five-minute intervals, missing observations shown as gaps." tabIndex={0}
      onPointerMove={e => move(e.clientX, e.currentTarget)} onPointerLeave={() => setSelected(null)}
      onKeyDown={e => { if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); } }}>
      <defs>
        <linearGradient id="drm-chart-players" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.players} stopOpacity=".19"/><stop offset="100%" stopColor={colors.players} stopOpacity="0"/></linearGradient>
        <linearGradient id="drm-chart-servers" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.servers} stopOpacity=".11"/><stop offset="100%" stopColor={colors.servers} stopOpacity="0"/></linearGradient>
      </defs>
      {[0, .25, .5, .75, 1].map(tick => <g key={tick}>
        <line x1={LEFT} x2={RIGHT} y1={BOTTOM-(BOTTOM-TOP)*tick} y2={BOTTOM-(BOTTOM-TOP)*tick} stroke="rgba(200,217,251,.125)" strokeDasharray="3 6"/>
        <text x={LEFT-12} y={BOTTOM-(BOTTOM-TOP)*tick+4} textAnchor="end" fontSize="11" fill="#a9bded">{Math.round(max.players*tick)}</text>
        <text x={RIGHT+12} y={BOTTOM-(BOTTOM-TOP)*tick+4} textAnchor="start" fontSize="11" fill="#80cba9">{Math.round(max.servers*tick)}</text>
      </g>)}
      {[0, .25, .5, .75, 1].map(tick => <text key={tick} x={LEFT+(RIGHT-LEFT)*tick} y="282" textAnchor={tick === 0?'start':tick === 1?'end':'middle'} fill="#9caec7" fontSize="11">{history.length ? label(history[Math.round((history.length-1)*tick)].time) : ''}</text>)}
      {keys.map(key => <g key={key}>{paths[key].areas.map((d,i)=><path key={`area-${i}`} d={d} fill={`url(#drm-chart-${key})`}/>)}{paths[key].segments.map((d,i)=><path key={`line-${i}`} d={d} stroke={colors[key]} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" fill="none"/>)}{paths[key].singletons.map((point,i)=><circle key={`point-${i}`} cx={point.cx} cy={point.cy} r="4.5" stroke="#0d1422" strokeWidth="2" fill={colors[key]}/>)}</g>)}
      {focus && selected !== null && <g><line x1={x(focusIndex)} x2={x(focusIndex)} y1={TOP} y2={BOTTOM} stroke="white" strokeOpacity=".36" strokeDasharray="4 5"/>{keys.map(key=>focus[key] === null ? null : <circle key={key} cx={x(focusIndex)} cy={y(key, focus[key])} r="5" stroke="#0d1422" strokeWidth="2" fill={colors[key]}/>)}</g>}
    </svg></div> : <div className="flex h-52 flex-col items-center justify-center text-center text-[#9baec5]"><p className="font-semibold text-[#dce7f8]">No historical samples yet</p><p className="text-xs mt-2">Five-minute observations appear after an opted-in node sends telemetry.</p></div>}
    <p className="chart-note">Rolling 24h · Unique player UUIDs across active nodes · Five-minute UTC intervals · Missing samples are gaps, not zero · Arrow keys inspect observations · Independent labeled Y-axes</p>
  </div>;
}
