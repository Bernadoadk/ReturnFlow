// ---------- Returns list ----------
function ReturnsPage({ returns, onOpenReturn }) {
  const [tab, setTab] = useState('All');
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [statusFilter, setStatusFilter] = useState('Any status');
  const [selected, setSelected] = useState(new Set());

  const counts = useMemo(() => {
    const c = { All: returns.length, Pending: 0, Approved: 0, Received: 0, Refunded: 0, Rejected: 0 };
    returns.forEach(r => { c[r.status.charAt(0) + r.status.slice(1).toLowerCase()] = (c[r.status.charAt(0) + r.status.slice(1).toLowerCase()] || 0) + 1; });
    return c;
  }, [returns]);

  // Pad the counts to feel realistic (spec lists hardcoded totals)
  const TAB_COUNTS = { All: 47, Pending: 12, Approved: 8, Received: 5, Refunded: 19, Rejected: 3 };
  const tabs = ['All', 'Pending', 'Approved', 'Received', 'Refunded', 'Rejected'];

  const filtered = useMemo(() => {
    let list = returns;
    if (tab !== 'All') list = list.filter(r => r.status === tab.toUpperCase());
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(r =>
        r.rma.toLowerCase().includes(q) ||
        r.order.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q));
    }
    if (statusFilter !== 'Any status') list = list.filter(r => r.status === statusFilter.toUpperCase());
    return list;
  }, [returns, tab, query, statusFilter]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.rma)));
  };
  const toggleOne = (rma) => {
    const s = new Set(selected);
    if (s.has(rma)) s.delete(rma); else s.add(rma);
    setSelected(s);
  };

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Review, approve and track customer return requests."
        right={
          <>
            <span className="text-[12px] px-2.5 py-1 rounded font-semibold tracking-wide" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F59E0B] mr-1.5 align-middle animate-pulseSoft" />
              12 pending
            </span>
            <Btn variant="secondary" icon="Download">Export CSV</Btn>
          </>
        } />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-divider mb-4 overflow-x-auto -mx-1 px-1">
        {tabs.map(t => {
          const active = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              {t}
              <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded ${active ? 'text-accent2 bg-accent/15' : 'text-faint bg-white/5'}`}>
                {TAB_COUNTS[t]}
              </span>
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[280px] max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Icon name="Search" size={14} /></span>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by RMA, order, customer email..."
            className="w-full h-9 pl-9 pr-3 text-[13px] rounded-md bg-surface border border-border text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        </div>
        <Select value={dateRange} onChange={setDateRange} className="w-[160px]"
          options={['Last 7 days', 'Last 30 days', 'Last 90 days', 'This year', 'All time']} />
        <Select value={statusFilter} onChange={setStatusFilter} className="w-[160px]"
          options={['Any status', 'PENDING', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED']} />
        <Btn variant="ghost" icon="Filter" className="ml-auto">More filters</Btn>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-md px-3 py-2 text-[13px] animate-fadeIn">
          <span className="text-ink font-medium">{selected.size} selected</span>
          <span className="text-muted">·</span>
          <button className="text-accent2 hover:text-white transition">Approve all</button>
          <button className="text-accent2 hover:text-white transition">Reject all</button>
          <button className="text-muted hover:text-ink transition ml-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-bg/40">
            <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-divider">
              <th className="font-semibold py-3 pl-5 pr-2 w-8">
                <input type="checkbox" className="rf-check" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th className="text-left font-semibold py-3">RMA</th>
              <th className="text-left font-semibold py-3">Order</th>
              <th className="text-left font-semibold py-3">Customer</th>
              <th className="text-left font-semibold py-3">Date</th>
              <th className="text-left font-semibold py-3">Items</th>
              <th className="text-right font-semibold py-3">Amount</th>
              <th className="text-left font-semibold py-3 pl-4">Status</th>
              <th className="text-right font-semibold py-3 pr-5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-muted">
                <div className="flex flex-col items-center gap-2">
                  <Icon name="PackageOpen" size={28} className="text-faint" />
                  <div className="text-[13px]">No returns match your filters.</div>
                </div>
              </td></tr>
            )}
            {filtered.map((r, i) => (
              <tr key={r.rma}
                  className={`border-b border-divider last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors ${selected.has(r.rma) ? 'bg-accent/[0.04]' : ''}`}
                  onClick={() => onOpenReturn(r.rma)}>
                <td className="py-3.5 pl-5 pr-2" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="rf-check" checked={selected.has(r.rma)} onChange={() => toggleOne(r.rma)} />
                </td>
                <td className="py-3.5 font-mono text-[12px] text-ink">{r.rma}</td>
                <td className="py-3.5 text-muted">{r.order}</td>
                <td className="py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full grid place-content-center text-[11px] font-semibold text-white"
                         style={{ background: 'linear-gradient(135deg,' + ['#6C63FF','#3B82F6','#8B5CF6','#22C55E','#F59E0B'][i % 5] + ',' + ['#8B85FF','#60a5fa','#a78bfa','#4ade80','#fbbf24'][i % 5] + ')' }}>
                      {r.customer.split(' ').map(p => p[0]).slice(0,2).join('')}
                    </div>
                    <div>
                      <div className="text-ink leading-tight">{r.customer}</div>
                      <div className="text-[11px] text-muted leading-tight mt-0.5">{r.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 text-muted">{r.date}</td>
                <td className="py-3.5 text-muted">{r.itemsCount}</td>
                <td className="py-3.5 text-right tabular-nums text-ink font-medium">${r.amount.toFixed(2)}</td>
                <td className="py-3.5 pl-4"><StatusBadge status={r.status} /></td>
                <td className="py-3.5 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onOpenReturn(r.rma)}
                          className="text-[12px] font-medium px-2.5 py-1 rounded border border-border text-ink hover:bg-white/5 hover:border-[#3a3e58] transition">
                    {r.status === 'PENDING' ? 'Review' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-divider bg-bg/20">
          <div className="text-[12.5px] text-muted">
            Showing <span className="text-ink font-medium">1–{filtered.length}</span> of <span className="text-ink font-medium">47</span> returns
          </div>
          <div className="flex items-center gap-1.5">
            <button className="h-8 px-3 text-[12.5px] rounded-md border border-border text-muted hover:text-ink hover:bg-white/5 transition flex items-center gap-1.5" disabled>
              <Icon name="ChevronLeft" size={13} /> Previous
            </button>
            <button className="h-8 px-3 text-[12.5px] rounded-md border border-border text-ink hover:bg-white/5 transition flex items-center gap-1.5">
              Next <Icon name="ChevronRight" size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ReturnsPage = ReturnsPage;
