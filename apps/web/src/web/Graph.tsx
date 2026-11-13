import { useAppNavigate as useNavigate } from "../app/platform";
import { useQuery } from "@tanstack/react-query";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useMemo } from "react";
import { api } from "../lib/api";

interface N extends SimulationNodeDatum { id: string; title: string; degree: number; orphan: boolean; daily: boolean }

export function Graph() {
  const q = useQuery({ queryKey: ["graph"], queryFn: api.graph });
  const navigate = useNavigate();
  const layout = useMemo(() => {
    if (!q.data) return null;
    const degree = new Map<string, number>();
    for (const e of q.data.edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const nodes: N[] = q.data.nodes.map((n) => ({ id: n.id, title: n.title, orphan: n.orphan, daily: n.path.startsWith("daily/"), degree: degree.get(n.id) ?? 0 }));
    const links = q.data.edges.map((e) => ({ source: e.source, target: e.target }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<N, { source: string; target: string }>(links).id((d) => d.id).distance(90).strength(0.6))
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.09))
      .force("y", forceY(0).strength(0.12))
      .force("collide", forceCollide<N>((d) => 34 + d.degree * 3))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    const xs = nodes.map((n) => n.x ?? 0), ys = nodes.map((n) => n.y ?? 0);
    const pad = 70;
    const box = { x: Math.min(...xs, 0) - pad, y: Math.min(...ys, 0) - pad, w: Math.max(...xs, 0) - Math.min(...xs, 0) + pad * 2, h: Math.max(...ys, 0) - Math.min(...ys, 0) + pad * 2 };
    return { nodes, links: links as unknown as { source: N; target: N }[], box };
  }, [q.data]);

  return (
    <div className="flex h-full flex-col gap-3 px-5 py-7 sm:px-9">
      <div className="flex items-end justify-between">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight">Graph</h1>
        <p className="m-0 text-xs text-muted">{q.data ? `${q.data.nodes.length} notes · ${q.data.edges.length} links · ${q.data.dangling.length} unresolved` : ""}</p>
      </div>
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-xl border border-line bg-panel">
        {layout && (
          <svg role="img" aria-label="Note link graph" viewBox={`${layout.box.x} ${layout.box.y} ${layout.box.w} ${layout.box.h}`} className="h-full w-full">
            {layout.links.map((l, i) => (
              <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} stroke="var(--tg-check)" strokeWidth={1.2} />
            ))}
            {layout.nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} className="cursor-pointer" onClick={() => navigate(`/notes/${n.id}`)} role="link" aria-label={n.title} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/notes/${n.id}`)}>
                <circle r={9 + Math.min(n.degree, 8) * 2.5} fill={n.orphan ? "var(--tg-check)" : n.daily ? "var(--tg-warn-dot)" : "var(--tg-accent)"} opacity={n.orphan ? 0.8 : 1} stroke="var(--tg-bg)" strokeWidth={3} />
                <text y={24 + Math.min(n.degree, 8) * 2.5} textAnchor="middle" fontSize={13} fontWeight={500} fill={n.orphan ? "var(--tg-hint)" : "var(--tg-fg)"}>{n.title}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
      <p className="m-0 text-xs text-muted"><span className="text-accent-soft">●</span> notes · <span className="text-[var(--tg-warn-dot)]">●</span> daily notes · <span className="text-[var(--tg-check)]">●</span> unlinked</p>
    </div>
  );
}
