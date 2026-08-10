// The home screen: every conversation is a dot, sized by how much was said,
// connected to the conversations it shares distinctive vocabulary with.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { PauseIcon, PlayIcon } from './Icons';

export const CLUSTER_PALETTE = [
  '#e8935c',
  '#5fa8e0',
  '#7ec8a5',
  '#d98bb7',
  '#9d8df1',
  '#e0766f',
  '#54c6bb',
  '#cfb45e',
  '#8fa5e8',
  '#c48fdb',
  '#a3c979',
  '#d9a0a0',
];

export function monthColor(iso: string): string {
  const m = new Date(iso).getMonth();
  return `hsl(${m * 30}, 52%, 60%)`;
}

interface MapNode extends NodeObject {
  id: string;
  name: string;
  val: number;
  cluster: number;
  updated_at: string;
  messageCount: number;
  keywords: string[];
}

interface MapLink {
  source: string | MapNode;
  target: string | MapNode;
  weight: number;
}

export function MapView() {
  const { scopedConvs, edges, matchedConvIds, query, openConversation, theme } = useStore();
  const fgRef = useRef<ForceGraphMethods<MapNode, MapLink> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [paused, setPaused] = useState(false);
  const [colourBy, setColourBy] = useState<'cluster' | 'month'>('cluster');
  const [threshold, setThreshold] = useState(0.04);
  const [hover, setHover] = useState<MapNode | null>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const nodeCache = useRef(new Map<string, MapNode>());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodes: MapNode[] = scopedConvs.map((c) => {
      // Reuse node objects between renders so the layout keeps its positions.
      const prev = nodeCache.current.get(c.uuid);
      const node: MapNode =
        prev ??
        ({
          id: c.uuid,
        } as MapNode);
      node.name = c.name;
      node.val = Math.min(14 + c.messageCount * 2.2, 130);
      node.cluster = c.cluster;
      node.updated_at = c.updated_at;
      node.messageCount = c.messageCount;
      node.keywords = c.keywords;
      nodeCache.current.set(c.uuid, node);
      return node;
    });
    const inScope = new Set(scopedConvs.map((c) => c.uuid));
    const degree = new Map<string, number>();
    const links: MapLink[] = [];
    for (const e of edges) {
      if (e.weight < threshold) continue;
      if (!inScope.has(e.source) || !inScope.has(e.target)) continue;
      const ds = degree.get(e.source) ?? 0;
      const dt = degree.get(e.target) ?? 0;
      if (ds >= 5 || dt >= 5) continue; // roughly five connections per conversation
      degree.set(e.source, ds + 1);
      degree.set(e.target, dt + 1);
      links.push({ source: e.source, target: e.target, weight: e.weight });
    }
    return { nodes, links };
  }, [scopedConvs, edges, threshold]);

  const searching = query.trim().length > 0;

  const nodeColor = useCallback(
    (n: MapNode) => (colourBy === 'cluster' ? CLUSTER_PALETTE[n.cluster % CLUSTER_PALETTE.length] : monthColor(n.updated_at)),
    [colourBy],
  );

  const drawNode = useCallback(
    (node: MapNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = Math.sqrt(node.val) * 1.6;
      const matched = matchedConvIds.has(node.id);
      const dimmed = searching && !matched;
      ctx.globalAlpha = dimmed ? 0.14 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(node);
      ctx.fill();
      if (matched && searching) {
        ctx.lineWidth = 1.6 / globalScale + 0.6;
        ctx.strokeStyle = 'var(--accent)' as string;
        ctx.strokeStyle = theme === 'dark' ? '#ff9d73' : '#c65634';
        ctx.stroke();
      }
      if (hover?.id === node.id) {
        ctx.lineWidth = 1.2 / globalScale + 0.4;
        ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#1a1c22';
        ctx.stroke();
      }
      // Show titles once zoomed in enough (or when highlighted by a search).
      if (globalScale > 1.6 || (matched && searching && globalScale > 0.8)) {
        const label = node.name.length > 34 ? node.name.slice(0, 32) + '…' : node.name;
        ctx.font = `${Math.max(10 / globalScale, 2.4)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme === 'dark' ? 'rgba(235,236,240,0.85)' : 'rgba(26,28,34,0.85)';
        ctx.fillText(label, x, y + r + 2 / globalScale);
      }
      ctx.globalAlpha = 1;
    },
    [matchedConvIds, searching, nodeColor, hover, theme],
  );

  const togglePause = useCallback(() => {
    if (!fgRef.current) return;
    if (paused) fgRef.current.resumeAnimation();
    else fgRef.current.pauseAnimation();
    setPaused(!paused);
  }, [paused]);

  // Legend: name each topic cluster after its members' most common keyword.
  const legend = useMemo(() => {
    if (colourBy === 'month') return null;
    const byCluster = new Map<number, Map<string, number>>();
    const counts = new Map<number, number>();
    for (const c of scopedConvs) {
      counts.set(c.cluster, (counts.get(c.cluster) ?? 0) + 1);
      let kw = byCluster.get(c.cluster);
      if (!kw) byCluster.set(c.cluster, (kw = new Map()));
      c.keywords.forEach((k, i) => kw!.set(k, (kw!.get(k) ?? 0) + (5 - i)));
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([cluster, n]) => {
        const kws = byCluster.get(cluster)!;
        const top = [...kws.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k]) => k);
        return { cluster, label: top.join(' · ') || 'misc', count: n };
      });
  }, [scopedConvs, colourBy]);

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      onMouseMove={(e) => {
        mouse.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          const r = Math.sqrt((node as MapNode).val) * 1.6 + 3;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={() => (theme === 'dark' ? 'rgba(160,165,180,0.18)' : 'rgba(60,64,80,0.16)')}
        linkWidth={(l) => 0.5 + (l as MapLink).weight * 6}
        onNodeHover={(n) => setHover((n as MapNode) ?? null)}
        onNodeClick={(n) => openConversation((n as MapNode).id)}
        cooldownTicks={200}
        d3VelocityDecay={0.35}
      />

      <div className="map-controls">
        <button className="ghost-btn" onClick={togglePause} title={paused ? 'Resume the motion' : 'Pause the motion'}>
          {paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
        <div className="seg">
          <button className={colourBy === 'cluster' ? 'seg-on' : ''} onClick={() => setColourBy('cluster')}>
            By topic
          </button>
          <button className={colourBy === 'month' ? 'seg-on' : ''} onClick={() => setColourBy('month')}>
            By month
          </button>
        </div>
        <label className="slider-label" title="Higher = only the strongest connections are drawn">
          Connections
          <input type="range" min={0.02} max={0.25} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
      </div>

      {legend && legend.length > 1 && (
        <div className="map-legend">
          {legend.map((l) => (
            <span key={l.cluster} className="legend-item">
              <span className="legend-dot" style={{ background: CLUSTER_PALETTE[l.cluster % CLUSTER_PALETTE.length] }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {colourBy === 'month' && (
        <div className="map-legend">
          {['Jan', 'Apr', 'Jul', 'Oct'].map((m, i) => (
            <span key={m} className="legend-item">
              <span className="legend-dot" style={{ background: `hsl(${i * 90}, 52%, 60%)` }} />
              {m}
            </span>
          ))}
        </div>
      )}

      {hover && (
        <div
          className="map-tooltip"
          style={{
            left: Math.min(mouse.current.x + 14, size.w - 280),
            top: Math.min(mouse.current.y + 14, size.h - 140),
          }}
        >
          <strong>{hover.name}</strong>
          <span>
            {formatDate(hover.updated_at)} · {hover.messageCount} message{hover.messageCount === 1 ? '' : 's'}
          </span>
          {hover.keywords.length > 0 && <span className="tooltip-keywords">{hover.keywords.join(' · ')}</span>}
        </div>
      )}
    </div>
  );
}
