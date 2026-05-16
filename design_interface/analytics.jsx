// ---------- Analytics ----------
function AnalyticsPage() {
  const [period, setPeriod] = useState('30 days');

  const data = RETURNS_OVER_TIME;
  const max = Math.max(...data);

  // Build line chart path (0..1 normalized then scaled)
  const W = 720, H = 200, PAD_L = 28, PAD_R = 8, PAD_T = 12, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const stepX = innerW / (data.length - 1);
  const points = data.map((v, i) => [PAD_L + i * stepX, PAD_T + innerH - (v / max) * innerH]);
  const linePath = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${(W - PAD_R).toFixed(1)},${(H - PAD_B).toFixed(1)} L${PAD_L},${(H - PAD_B).toFixed(1)} Z`;

  // Donut: cumulative arcs
  const cx = 90, cy = 90, rO = 78, rI = 50;
  let acc = 0;
  const donutSlices = TOP_REASONS.map((r) => {
    const start = acc / 100, end = (acc + r.pct) / 100;
    acc += r.pct;
    return { ...r, path: donutPath(cx, cy, rO, rI, start, end) };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Spot patterns and reduce return rates."
        right={
          <div className="inline-flex items-center bg-surface border border-border rounded-md p-0.5">
            {['7 days', '30 days', '90 days'].map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 h-7 text-[12px] font-medium rounded transition-colors ${
                  period === p ? 'bg-accent/15 text-accent2' : 'text-muted hover:text-ink'
                }`}>{p}</button>
            ))}
          </div>
        } />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniKpi label="Total Returns"        value="47"        delta="+8"   tone="muted" />
        <MiniKpi label="Refund Amount"        value="$8,234"    delta="+12%" tone="ok" />
        <MiniKpi label="Avg Processing Time"  value="1.8 days"  delta="-0.4d" tone="ok" />
        <MiniKpi label="Exchange Rate"        value="23%"       delta="+3pp" tone="ok" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card title="Returns Over Time" subtitle={`Last ${period}`} className="lg:col-span-3">
          <div className="w-full overflow-hidden">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
              <defs>
                <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#6C63FF" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#6C63FF" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => {
                const y = PAD_T + innerH * t;
                const v = Math.round(max * (1 - t));
                return (
                  <g key={t}>
                    <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#2E3148" strokeDasharray="3 4" />
                    <text x={PAD_L - 6} y={y + 3} fontSize="9" fill="#5B5F75" textAnchor="end">{v}</text>
                  </g>
                );
              })}
              {/* x axis labels (every 5 days) */}
              {data.map((_, i) => i % 5 === 0 ? (
                <text key={i} x={PAD_L + i * stepX} y={H - 6} fontSize="9" fill="#5B5F75" textAnchor="middle">Day {i + 1}</text>
              ) : null)}
              <path d={areaPath} fill="url(#lg)" />
              <path d={linePath} fill="none" stroke="#8B85FF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={i === points.length - 1 ? 4 : 2.2}
                        fill={i === points.length - 1 ? '#fff' : '#8B85FF'} stroke="#6C63FF" strokeWidth={i === points.length - 1 ? 2 : 0} />
              ))}
            </svg>
          </div>
          <div className="flex items-center justify-between mt-3 text-[12px] text-muted">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent2"></span> Returns / day</div>
            <div>Peak: <span className="text-ink font-medium">8 returns</span> on Day 23</div>
          </div>
        </Card>

        <Card title="Return Reasons Breakdown" className="lg:col-span-2">
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <svg width="180" height="180" viewBox="0 0 180 180">
                {donutSlices.map((s, i) => (
                  <path key={i} d={s.path} fill={s.color} opacity="0.92">
                    <title>{s.name}: {s.pct}%</title>
                  </path>
                ))}
                <text x="90" y="86" fontSize="22" fontWeight="600" fill="#F0F0F5" textAnchor="middle">47</text>
                <text x="90" y="104" fontSize="10" fill="#8B8FA8" textAnchor="middle">total returns</text>
              </svg>
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              {TOP_REASONS.map(r => (
                <div key={r.name} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.color }} />
                  <span className="text-muted truncate flex-1">{r.name}</span>
                  <span className="text-ink tabular-nums font-medium">{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Top Returned Products" subtitle="Most-returned items this period">
          <div className="space-y-3">
            {TOP_PRODUCTS.map((p, i) => {
              const pct = (p.count / TOP_PRODUCTS[0].count) * 100;
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-[13px] mb-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-faint w-4 text-right tabular-nums text-[11.5px]">{i + 1}</span>
                      <span className="text-ink">{p.name}</span>
                    </div>
                    <span className="text-muted tabular-nums">{p.count} returns</span>
                  </div>
                  <div className="ml-6 h-1.5 rounded-full bg-bg overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                         style={{ width: pct + '%', background: 'linear-gradient(90deg,#6C63FF,#8B85FF)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Return Reason Details">
          <div className="-mx-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-divider">
                  <th className="text-left font-semibold py-2.5 px-5">Reason</th>
                  <th className="text-right font-semibold py-2.5">Count</th>
                  <th className="text-right font-semibold py-2.5">Share</th>
                  <th className="text-right font-semibold py-2.5 px-5">Trend</th>
                </tr>
              </thead>
              <tbody>
                {TOP_REASONS.map((r, i) => {
                  const trend = [+2, -1, +3, 0, -2][i];
                  return (
                    <tr key={r.name} className="border-b border-divider last:border-0">
                      <td className="py-3 px-5">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                          <span className="text-ink">{r.name}</span>
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums text-ink">{r.count}</td>
                      <td className="py-3 text-right tabular-nums text-muted">{r.pct}%</td>
                      <td className="py-3 px-5 text-right tabular-nums text-[12px]">
                        <span style={{ color: trend > 0 ? '#EF4444' : trend < 0 ? '#22C55E' : '#8B8FA8' }}>
                          {trend > 0 ? '↑' : trend < 0 ? '↓' : '–'} {Math.abs(trend)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, delta, tone }) {
  const color = tone === 'ok' ? '#22C55E' : tone === 'warn' ? '#F59E0B' : tone === 'danger' ? '#EF4444' : '#8B8FA8';
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-[11.5px] text-muted font-medium">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold text-ink tracking-tight tabular-nums">{value}</span>
        <span className="text-[11.5px] tabular-nums" style={{ color }}>{delta}</span>
      </div>
    </div>
  );
}

// Build an SVG donut slice path
function donutPath(cx, cy, rO, rI, start, end) {
  if (end - start >= 0.999) end = start + 0.999;
  const a0 = (start - 0.25) * Math.PI * 2;
  const a1 = (end   - 0.25) * Math.PI * 2;
  const large = end - start > 0.5 ? 1 : 0;
  const x0 = cx + Math.cos(a0) * rO, y0 = cy + Math.sin(a0) * rO;
  const x1 = cx + Math.cos(a1) * rO, y1 = cy + Math.sin(a1) * rO;
  const x2 = cx + Math.cos(a1) * rI, y2 = cy + Math.sin(a1) * rI;
  const x3 = cx + Math.cos(a0) * rI, y3 = cy + Math.sin(a0) * rI;
  return `M${x0},${y0} A${rO},${rO} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rI},${rI} 0 ${large} 0 ${x3},${y3} Z`;
}

window.AnalyticsPage = AnalyticsPage;
