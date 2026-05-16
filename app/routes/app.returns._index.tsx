import { useState, useMemo } from "react";
import { Link, useNavigate, useLocation, useLoaderData, useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Select, StatusBadge } from "../components/ui";
import { sendReturnEmail } from "../lib/mailer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "bulk_status") {
    const rmas = JSON.parse(formData.get("rmas") as string) as string[];
    const status = formData.get("status") as string;
    await prisma.returnRequest.updateMany({
      where: { shop, rma: { in: rmas } },
      data: { status }
    });
    return { success: true, updated: rmas.length };
  }

  if (intent === "export_csv") {
    const returnRequests = await prisma.returnRequest.findMany({
      where: { shop },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    const rows: (string | number)[][] = [
      ['RMA','Order','Customer','Email','Status','Refund Type','Amount','Items','Date'],
      ...returnRequests.map((r: any) => [
        r.rma, r.orderName, r.customerName ?? '', r.customerEmail,
        r.status, r.refundType, r.refundAmount.toFixed(2),
        r.items.length,
        new Date(r.createdAt).toISOString().split('T')[0]
      ])
    ];
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="returns-${new Date().toISOString().split('T')[0]}.csv"`
      }
    });
  }

  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Auto-expire: find APPROVED returns older than autoExpireDays with no shipping
  const shopSettings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (shopSettings) {
    const expireDays = shopSettings.autoExpireDays ?? 7;
    const expireCutoff = new Date(Date.now() - expireDays * 86400000);
    const toExpire = await prisma.returnRequest.findMany({
      where: { shop, status: 'APPROVED', shippedAt: null, updatedAt: { lt: expireCutoff } },
      select: { id: true, rma: true, orderName: true, customerEmail: true, customerName: true }
    });
    if (toExpire.length > 0) {
      await prisma.returnRequest.updateMany({
        where: { id: { in: toExpire.map((r: any) => r.id) } },
        data: { status: 'EXPIRED' }
      });
      await Promise.allSettled(toExpire.map((r: any) =>
        sendReturnEmail("Expired", {
          to: r.customerEmail,
          shop,
          fromEmail: shopSettings.fromEmail ?? undefined,
          customer_name: r.customerName || r.customerEmail.split('@')[0],
          rma_number: r.rma,
          order_number: r.orderName,
        })
      ));
    }
  }

  const returnRequests = await prisma.returnRequest.findMany({
    where: { shop: session.shop },
    include: { items: true },
    orderBy: { createdAt: 'desc' }
  });

  return { returnRequests };
};

export default function ReturnsPage() {
  const { returnRequests } = useLoaderData<typeof loader>();

  const [tab, setTab] = useState('All');
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [statusFilter, setStatusFilter] = useState('Any status');
  const [selected, setSelected] = useState(new Set<string>());
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();

  const handleBulkAction = (status: string) => {
    const fd = new FormData();
    fd.append("intent", "bulk_status");
    fd.append("rmas", JSON.stringify([...selected]));
    fd.append("status", status);
    fetcher.submit(fd, { method: "POST" });
    setSelected(new Set());
  };

  const handleExportCSV = () => {
    const fd = new FormData();
    fd.append("intent", "export_csv");
    fetcher.submit(fd, { method: "POST", action: location.pathname + location.search });
  };

  const listData = returnRequests.map((r: any) => ({
    rma: r.rma,
    order: r.orderName,
    customer: r.customerName || r.customerEmail.split('@')[0],
    email: r.customerEmail,
    date: new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    createdAt: new Date(r.createdAt),
    itemsCount: r.items.reduce((sum: number, it: any) => sum + it.quantity, 0),
    amount: r.refundAmount || r.orderTotal,
    status: r.status
  }));

  const TABS = ['All', 'Pending', 'Approved', 'Shipped', 'Received', 'Refunded', 'Rejected', 'Expired'];
  const TAB_COUNTS: Record<string, number> = {
    All:      listData.length,
    Pending:  listData.filter((r: any) => r.status === 'PENDING').length,
    Approved: listData.filter((r: any) => r.status === 'APPROVED').length,
    Shipped:  listData.filter((r: any) => r.status === 'SHIPPED').length,
    Received: listData.filter((r: any) => r.status === 'RECEIVED').length,
    Refunded: listData.filter((r: any) => r.status === 'REFUNDED').length,
    Rejected: listData.filter((r: any) => r.status === 'REJECTED').length,
    Expired:  listData.filter((r: any) => r.status === 'EXPIRED').length,
  };

  const filtered = useMemo(() => {
    let list = listData;

    if (dateRange !== 'All time') {
      const now = new Date();
      const cutoff = new Date(now);
      if (dateRange === 'Last 7 days')  cutoff.setDate(now.getDate() - 7);
      else if (dateRange === 'Last 30 days') cutoff.setDate(now.getDate() - 30);
      else if (dateRange === 'Last 90 days') cutoff.setDate(now.getDate() - 90);
      else if (dateRange === 'This year')    cutoff.setMonth(0, 1);
      list = list.filter((r: any) => r.createdAt >= cutoff);
    }

    if (tab !== 'All') list = list.filter((r: any) => r.status === tab.toUpperCase());
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r: any) =>
        r.rma.toLowerCase().includes(q) ||
        r.order.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q));
    }
    if (statusFilter !== 'Any status') list = list.filter((r: any) => r.status === statusFilter);
    return list;
  }, [tab, query, statusFilter, dateRange, listData]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r: any) => r.rma)));
  };
  const toggleOne = (rma: string) => {
    const s = new Set(selected);
    if (s.has(rma)) s.delete(rma); else s.add(rma);
    setSelected(s);
  };

  const avatarColors = [
    ['#6C63FF','#8B85FF'], ['#3B82F6','#60a5fa'],
    ['#8B5CF6','#a78bfa'], ['#22C55E','#4ade80'], ['#F59E0B','#fbbf24']
  ];

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Review, approve and track customer return requests."
        right={
          <>
            {TAB_COUNTS['Pending'] > 0 && (
              <span className="text-[12px] px-2.5 py-1 rounded font-semibold tracking-wide" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#F59E0B] mr-1.5 align-middle animate-pulseSoft" />
                {TAB_COUNTS['Pending']} pending
              </span>
            )}
            {TAB_COUNTS['Shipped'] > 0 && (
              <span className="text-[12px] px-2.5 py-1 rounded font-semibold tracking-wide" style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10B981] mr-1.5 align-middle" />
                {TAB_COUNTS['Shipped']} in transit
              </span>
            )}
            <Btn variant="secondary" icon="Download" onClick={handleExportCSV}>Export CSV</Btn>
          </>
        } />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-divider mb-4 overflow-x-auto -mx-1 px-1">
        {TABS.map(t => {
          const active = tab === t;
          const count = TAB_COUNTS[t];
          if (count === 0 && t !== 'All' && t !== 'Pending' && t !== 'Approved' && t !== 'Shipped') return null;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              {t}
              <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded ${active ? 'text-accent2 bg-accent/15' : 'text-faint bg-white/5'}`}>
                {count}
              </span>
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20">
          <span className="text-[13px] font-medium text-accent2">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-2">
            <Btn variant="secondary" size="sm" onClick={() => handleBulkAction('APPROVED')}>Approve all</Btn>
            <Btn variant="secondary" size="sm" onClick={() => handleBulkAction('REJECTED')}>Reject all</Btn>
            <Btn variant="secondary" size="sm" onClick={() => handleBulkAction('RECEIVED')}>Mark received</Btn>
          </div>
          <button className="ml-auto text-faint hover:text-ink" onClick={() => setSelected(new Set())}>
            <Icon name="X" size={14} />
          </button>
        </div>
      )}

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
          options={['Any status', 'PENDING', 'APPROVED', 'SHIPPED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'EXPIRED']} />
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] whitespace-nowrap min-w-[800px]">
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
              {filtered.map((r: any, i: number) => {
                const [c1, c2] = avatarColors[i % 5];
                return (
                  <tr key={r.rma}
                      className={`border-b border-divider last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors ${selected.has(r.rma) ? 'bg-accent/[0.04]' : ''}`}
                      onClick={() => navigate(`/app/returns/${r.rma}${location.search}`)}>
                    <td className="py-3.5 pl-5 pr-2 relative z-10" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rf-check" checked={selected.has(r.rma)} onChange={() => toggleOne(r.rma)} />
                    </td>
                    <td className="py-3.5 font-mono text-[12px] text-ink">{r.rma}</td>
                    <td className="py-3.5 text-muted">{r.order}</td>
                    <td className="py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full grid place-content-center text-[11px] font-semibold text-white shrink-0"
                             style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
                          {r.customer.split(' ').map((p: string) => p[0]).slice(0,2).join('').toUpperCase()}
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
                    <td className="py-3.5 pr-5 text-right relative z-10" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/app/returns/${r.rma}${location.search}`}
                              className="text-[12px] font-medium px-2.5 py-1 rounded border border-border text-ink hover:bg-white/5 hover:border-[#3a3e58] transition">
                        {r.status === 'PENDING' ? 'Review' : r.status === 'APPROVED' ? 'Action' : 'View'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-divider bg-bg/20">
          <div className="text-[12.5px] text-muted">
            Showing <span className="text-ink font-medium">{filtered.length > 0 ? '1' : '0'}–{filtered.length}</span> of <span className="text-ink font-medium">{listData.length}</span> returns
          </div>
        </div>
      </div>
    </div>
  );
}
