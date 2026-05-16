// ---------- Billing ----------
function BillingPage() {
  const toast = useToast();
  const used = 8, limit = 10;
  const pct = used / limit * 100;

  const PLANS = [
    { id: 'free',    name: 'Free',    price: 0,  unit: 'forever',
      summary: '10 returns / month',
      features: ['Customer return portal', 'Email notifications', 'Basic analytics', 'Up to 10 returns/month'],
      current: true,
    },
    { id: 'starter', name: 'Starter', price: 19, unit: 'month', popular: true,
      summary: '100 returns / month',
      features: ['Everything in Free', 'Custom branding & logo', 'Advanced analytics', 'Email templates', 'Priority support'],
    },
    { id: 'pro',     name: 'Pro',     price: 49, unit: 'month',
      summary: 'Unlimited returns',
      features: ['Everything in Starter', 'API access & webhooks', 'Custom return reasons', 'White-label portal', 'Dedicated CSM'],
    },
  ];

  return (
    <div>
      <PageHeader title="Billing & Plans" subtitle="Manage your subscription and invoices." />

      {/* Current plan banner */}
      <div className="bg-surface border border-border rounded-lg p-5 mb-6 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full opacity-[0.06] bg-warn pointer-events-none" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md grid place-content-center" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
              <Icon name="Sparkles" size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-ink">You're on the <span className="text-warn">FREE</span> plan</span>
                <span className="text-[11px] px-2 py-0.5 rounded font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>10 returns/month</span>
              </div>
              <div className="text-[12.5px] text-muted mt-1">Upgrade to unlock branding, analytics and unlimited returns.</div>
            </div>
          </div>
          <div className="w-full md:w-[280px]">
            <div className="flex items-center justify-between text-[12px] mb-1.5">
              <span className="text-muted">Usage this month</span>
              <span className="text-ink font-semibold tabular-nums">{used} / {limit}</span>
            </div>
            <div className="h-2 rounded-full bg-bg overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                   style={{ width: pct + '%', background: pct >= 80 ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : 'linear-gradient(90deg,#6C63FF,#8B85FF)' }} />
            </div>
            <div className="text-[11px] text-warn mt-1.5 flex items-center gap-1">
              <Icon name="TriangleAlert" size={11} /> You're approaching your limit
            </div>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {PLANS.map(p => {
          const isPop = p.popular;
          return (
            <div key={p.id}
                 className={`relative bg-surface border rounded-xl p-6 flex flex-col transition-all ${
                   isPop ? 'border-accent shadow-[0_0_0_1px_rgba(108,99,255,0.5),0_12px_40px_rgba(108,99,255,0.18)]' : 'border-border hover:border-[#3a3e58]'
                 }`}>
              {isPop && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10.5px] font-bold px-2.5 py-1 rounded-full text-white tracking-wide"
                     style={{ background: 'linear-gradient(90deg,#6C63FF,#8B5CF6)', boxShadow: '0 4px 12px rgba(108,99,255,0.4)' }}>
                  ⭐ MOST POPULAR
                </div>
              )}
              <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: isPop ? '#8B85FF' : '#8B8FA8' }}>{p.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[36px] font-bold text-ink tracking-tight tabular-nums">${p.price}</span>
                <span className="text-[13px] text-muted">/{p.unit === 'month' ? 'mo' : p.unit}</span>
              </div>
              <div className="text-[13px] text-ink mt-1">{p.summary}</div>

              <div className="mt-5 pt-5 border-t border-divider space-y-2.5 flex-1">
                {p.features.map(f => (
                  <div key={f} className="flex items-start gap-2 text-[12.5px]">
                    <Icon name="Check" size={13} className="mt-0.5 shrink-0" style={{ color: isPop ? '#8B85FF' : '#22C55E' }} strokeWidth={2.5} />
                    <span className="text-ink">{f}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                {p.current ? (
                  <button disabled className="w-full h-10 rounded-md border border-border text-[13px] font-semibold text-muted bg-bg/40 cursor-default">
                    Current Plan
                  </button>
                ) : isPop ? (
                  <Btn variant="primary" className="w-full" size="lg"
                       onClick={() => toast({ kind: 'success', title: `Upgrading to ${p.name}`, body: '14-day free trial activated.' })}>
                    Upgrade to {p.name}
                  </Btn>
                ) : (
                  <Btn variant="secondary" className="w-full" size="lg"
                       onClick={() => toast({ kind: 'info', title: `${p.name} plan`, body: 'Redirecting to checkout…' })}>
                    Upgrade to {p.name}
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center text-[12.5px] text-muted mb-8 flex items-center justify-center gap-1.5">
        <Icon name="Gift" size={13} className="text-accent2"/>
        <span><span className="text-ink font-medium">14-day free trial</span> on all paid plans. Cancel anytime.</span>
      </div>

      {/* Invoices */}
      <Card title="Billing History" subtitle="Download invoices for your records">
        <div className="-mx-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint border-b border-divider">
                <th className="text-left font-semibold py-3 px-5">Invoice</th>
                <th className="text-left font-semibold py-3">Date</th>
                <th className="text-right font-semibold py-3">Amount</th>
                <th className="text-left font-semibold py-3 pl-6">Status</th>
                <th className="text-right font-semibold py-3 px-5"></th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map(inv => (
                <tr key={inv.id} className="border-b border-divider last:border-0 hover:bg-white/[0.02]">
                  <td className="py-3.5 px-5 font-mono text-[12px] text-ink">{inv.id}</td>
                  <td className="py-3.5 text-muted">{inv.date}</td>
                  <td className="py-3.5 text-right tabular-nums text-ink font-medium">{inv.amount}</td>
                  <td className="py-3.5 pl-6">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E' }}>
                      <Icon name="Check" size={10} strokeWidth={3.5} /> {inv.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-right">
                    <button onClick={() => toast({ kind: 'info', title: `Downloading ${inv.id}…` })}
                            className="text-[12px] font-medium text-accent2 hover:text-white inline-flex items-center gap-1 transition">
                      <Icon name="Download" size={12} /> PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-8 p-5 rounded-lg border border-divider bg-bg/30 flex items-start gap-3">
        <Icon name="MessageCircleQuestion" size={18} className="text-accent2 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Questions about pricing?</div>
          <div className="text-[12.5px] text-muted mt-0.5">Chat with our team — we usually reply within an hour.</div>
        </div>
        <Btn variant="secondary" size="sm" icon="MessageCircle">Contact us</Btn>
      </div>
    </div>
  );
}

window.BillingPage = BillingPage;
