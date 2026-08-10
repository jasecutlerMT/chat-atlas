// Conversations as dots on a zoomable horizontal timeline. Scroll to zoom,
// drag to pan, double-click to reset. Same hover and click behaviour as the map.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatDate } from '../lib/text';
import { CLUSTER_PALETTE } from './MapView';

interface Dot {
  uuid: string;
  name: string;
  t: number;
  r: number;
  cluster: number;
  messageCount: number;
  updated_at: string;
  keywords: string[];
}

const AXIS_H = 44;

function pickTicks(t0: number, t1: number): { t: number; label: string }[] {
  const span = t1 - t0;
  const day = 86_400_000;
  const ticks: { t: number; label: string }[] = [];
  const start = new Date(t0);
  if (span > 900 * day) {
    // years
    for (let y = start.getFullYear(); ; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t > t1) break;
      if (t >= t0) ticks.push({ t, label: String(y) });
    }
  } else if (span > 90 * day) {
    // months
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    for (;;) {
      const t = d.getTime();
      if (t > t1) break;
      if (t >= t0) ticks.push({ t, label: d.toLocaleDateString(undefined, { month: 'short', year: span > 300 * day ? '2-digit' : undefined }) });
      d.setMonth(d.getMonth() + 1);
    }
  } else if (span > 14 * day) {
    // weeks
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
    for (;;) {
      const t = d.getTime();
      if (t > t1) break;
      ticks.push({ t, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) });
      d.setDate(d.getDate() + 7);
    }
  } else {
    // days
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    for (;;) {
      const t = d.getTime();
      if (t > t1) break;
      if (t >= t0) ticks.push({ t, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) });
      d.setDate(d.getDate() + 1);
    }
  }
  return ticks.slice(0, 40);
}

export function TimelineView() {
  const { scopedConvs, matchedConvIds, query, openConversation } = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [domain, setDomain] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<Dot | null>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const dragging = useRef<{ startX: number; d0: number; d1: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const dots = useMemo<Dot[]>(
    () =>
      scopedConvs
        .map((c) => ({
          uuid: c.uuid,
          name: c.name,
          t: new Date(c.updated_at || c.created_at).getTime(),
          r: Math.min(5 + Math.sqrt(c.messageCount) * 2.2, 17),
          cluster: c.cluster,
          messageCount: c.messageCount,
          updated_at: c.updated_at,
          keywords: c.keywords,
        }))
        .filter((d) => !isNaN(d.t))
        .sort((a, b) => a.t - b.t),
    [scopedConvs],
  );

  const fullDomain = useMemo<[number, number]>(() => {
    if (dots.length === 0) {
      const now = Date.now();
      return [now - 30 * 86_400_000, now];
    }
    const min = dots[0].t;
    const max = dots[dots.length - 1].t;
    const pad = Math.max((max - min) * 0.04, 86_400_000);
    return [min - pad, max + pad];
  }, [dots]);

  const [d0, d1] = domain ?? fullDomain;
  const x = (t: number) => ((t - d0) / (d1 - d0)) * size.w;

  // Pack dots into lanes so overlapping conversations stack vertically.
  const placed = useMemo(() => {
    const lanes: number[] = [];
    const out: (Dot & { px: number; lane: number })[] = [];
    for (const d of dots) {
      const px = x(d.t);
      if (px < -30 || px > size.w + 30) continue;
      let lane = 0;
      while (lane < lanes.length && px - lanes[lane] < d.r * 2 + 26) lane++;
      lanes[lane] = px + d.r;
      out.push({ ...d, px, lane });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, d0, d1, size.w]);

  // Lane 0 sits mid-screen; further lanes alternate above and below it.
  const maxLane = Math.max(1, ...placed.map((p) => p.lane));
  const laneY = (lane: number) => {
    const usable = size.h - AXIS_H - 140;
    const step = Math.min(48, usable / (maxLane + 1));
    const centre = 110 + usable / 2;
    const offset = Math.ceil(lane / 2) * step * (lane % 2 === 1 ? -1 : 1);
    return centre + offset;
  };

  const searching = query.trim().length > 0;
  const ticks = pickTicks(d0, d1);

  const onWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const tAt = d0 + (mx / size.w) * (d1 - d0);
    let n0 = tAt - (tAt - d0) * factor;
    let n1 = tAt + (d1 - tAt) * factor;
    if (n1 - n0 < 3600_000) return;
    if (n1 - n0 > (fullDomain[1] - fullDomain[0]) * 3) return;
    setDomain([n0, n1]);
  };

  return (
    <div
      className="timeline-wrap"
      ref={wrapRef}
      onWheel={onWheel}
      onMouseMove={(e) => {
        mouse.current = { x: e.clientX, y: e.clientY };
        if (dragging.current) {
          const dx = e.clientX - dragging.current.startX;
          const dt = (dx / size.w) * (dragging.current.d1 - dragging.current.d0);
          setDomain([dragging.current.d0 - dt, dragging.current.d1 - dt]);
        }
      }}
      onMouseDown={(e) => {
        dragging.current = { startX: e.clientX, d0, d1 };
      }}
      onMouseUp={() => (dragging.current = null)}
      onMouseLeave={() => (dragging.current = null)}
      onDoubleClick={() => setDomain(null)}
    >
      {dots.length === 0 ? (
        <div className="view-empty">
          <p>Nothing to show here yet — once your conversations are in, they will line up along time.</p>
        </div>
      ) : (
        <svg width={size.w} height={size.h} role="img" aria-label="Timeline of conversations">
          <line x1={0} y1={size.h - AXIS_H} x2={size.w} y2={size.h - AXIS_H} className="tl-axis" />
          {ticks.map((tk) => (
            <g key={tk.t} transform={`translate(${x(tk.t)},0)`}>
              <line y1={30} y2={size.h - AXIS_H} className="tl-grid" />
              <text y={size.h - AXIS_H + 22} className="tl-tick" textAnchor="middle">
                {tk.label}
              </text>
            </g>
          ))}
          {placed.map((p) => {
            const matched = matchedConvIds.has(p.uuid);
            const dimmed = searching && !matched;
            return (
              <circle
                key={p.uuid}
                cx={p.px}
                cy={laneY(p.lane)}
                r={p.r}
                fill={CLUSTER_PALETTE[p.cluster % CLUSTER_PALETTE.length]}
                opacity={dimmed ? 0.15 : 0.92}
                className={`tl-dot ${matched && searching ? 'tl-dot-matched' : ''} ${hover?.uuid === p.uuid ? 'tl-dot-hover' : ''}`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onClick={() => openConversation(p.uuid)}
              />
            );
          })}
        </svg>
      )}
      <p className="timeline-hint">Scroll to zoom · drag to pan · double-click to reset</p>
      {hover && (
        <div
          className="map-tooltip"
          style={{ left: Math.min(mouse.current.x + 14, size.w - 280), top: Math.max(mouse.current.y - 90, 10) }}
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
