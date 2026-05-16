// ---------- Return Detail ----------
function ReturnDetailPage({ rmaId, returns, onBack, onUpdateStatus }) {
  const r = returns.find(x => x.rma === rmaId) || returns[0];
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [refundOpen,  setRefundOpen]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  // Refund modal state
  const [overrideMethod, setOverrideMethod] = useState(false);
  const [refundMethod,   setRefundMethod]   = useState(r.refundType || 'ORIGINAL_PAYMENT');
  const [refundAmountStr, setRefundAmountStr] = useState((r.amount || 0).toFixed(2));
  const [notes, setNotes] = useState([]);
  const [timeline, setTimeline] = useState([
    { kind: 'request', title: 'Return Requested', detail: 'Customer submitted return request via portal', time: 'May 15, 14:32', icon: 'PackagePlus', color: '#22C55E' },
    { kind: 'email',   title: 'Email Sent',       detail: `Confirmation email sent to ${r.email}`,         time: 'May 15, 14:32', icon: 'Mail',        color: '#3B82F6' },
  ]);

  const itemsTotal = r.items.reduce((s, it) => s + it.price * it.qty, 0);
  const restocking = 0;
  const refund = itemsTotal - restocking;
  const isPending  = r.status === 'PENDING';
  const isApproved = r.status === 'APPROVED';
  const isReceived = r.status === 'RECEIVED';

  const handleApprove = () => {
    onUpdateStatus(r.rma, 'APPROVED');
    setTimeline(t => [...t, { kind: 'approved', title: 'Return Approved', detail: 'Shipping instructions sent to customer', time: 'May 16, 09:14', icon: 'CircleCheck', color: '#3B82F6' }]);
    setApproveOpen(false);
    toast({ kind: 'success', title: 'Return approved', body: `${r.rma} — shipping label dispatched.` });
  };
  const handleReject = () => {
    if (!rejectReason.trim()) return;
    onUpdateStatus(r.rma, 'REJECTED');
    setTimeline(t => [...t, { kind: 'rejected', title: 'Return Rejected', detail: rejectReason, time: 'May 16, 09:14', icon: 'CircleX', color: '#EF4444' }]);
    setRejectOpen(false);
    toast({ kind: 'error', title: 'Return rejected', body: 'Customer has been notified.' });
  };
  const handleMarkReceived = () => {
    onUpdateStatus(r.rma, 'RECEIVED');
    setTimeline(t => [...t, { kind: 'received', title: 'Items Received', detail: 'All items confirmed at warehouse', time: 'May 16, 11:02', icon: 'PackageCheck', color: '#8B5CF6' }]);
    toast({ kind: 'success', title: 'Marked as received', body: 'Refund queue updated.' });
  };
  const openRefundModal = () => {
    setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT');
    setOverrideMethod(false);
    setRefundAmountStr((r.amount || 0).toFixed(2));
    setRefundOpen(true);
  };
  const handleRefund = () => {
    onUpdateStatus(r.rma, 'REFUNDED', { refundType: refundMethod });
    const methodLabel = REFUND_TYPES[refundMethod].label;
    setTimeline(t => [...t, { kind: 'refunded', title: 'Refund Issued', detail: `${methodLabel} · $${parseFloat(refundAmountStr || '0').toFixed(2)}`, time: 'May 16, 11:08', icon: 'DollarSign', color: '#22C55E' }]);
    setRefundOpen(false);
    toast({ kind: 'success', title: 'Refund issued', body: `${methodLabel} — $${parseFloat(refundAmountStr || '0').toFixed(2)} to ${r.customer}.` });
  };
  const handleAddNote = () => {
    if (!internalNote.trim()) return;
    setNotes(n => [{ id: Date.now(), text: internalNote.trim(), time: 'Just now', author: 'You' }, ...n]);
    setInternalNote('');
    toast({ kind: 'info', title: 'Note added' });
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition mb-4 group">
        <Icon name="ArrowLeft" size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Returns
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold text-ink tracking-tight font-mono">{r.rma}</h1>
            <StatusBadge status={r.status} size="lg" />
          </div>
          <div className="text-[13px] text-muted mt-1.5">Submitted {r.dateFull}</div>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="secondary" icon="MessageCircle" size="sm">Message customer</Btn>
          <Btn variant="ghost" icon="EllipsisVertical" size="sm"></Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">

          {/* Customer */}
          <Card title="Customer">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full grid place-content-center text-[14px] font-bold text-white shrink-0"
                   style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
                {r.customer.split(' ').map(p => p[0]).slice(0,2).join('')}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
                <div className="col-span-2">
                  <div className="text-ink font-semibold text-[14px]">{r.customer}</div>
                </div>
                <Field icon="Mail"     label="Email"        value={r.email} />
                <Field icon="Phone"    label="Phone"        value={r.phone} />
                <Field icon="Receipt"  label="Order"        value={<a className="text-accent2 hover:text-white">{r.order}</a>} />
                <Field icon="Calendar" label="Customer since" value={r.customerSince} />
              </div>
            </div>
          </Card>

          {/* Items */}
          <Card title="Items Requested" subtitle={`${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`}>
            <div className="space-y-3">
              {r.items.map((it, i) => (
                <div key={i} className="flex gap-4 p-3 rounded-md bg-bg/40 border border-divider">
                  <div className="w-16 h-16 rounded-md grid place-content-center shrink-0 relative overflow-hidden"
                       style={{ background: `linear-gradient(135deg, ${it.color}, ${it.color}cc)` }}>
                    <Icon name="Shirt" size={22} className="text-white/50" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-[13.5px] font-semibold text-ink">{it.name}</div>
                        <div className="text-[12px] text-muted mt-0.5">{it.variant} · Qty {it.qty}</div>
                      </div>
                      <div className="text-[13.5px] font-semibold text-ink tabular-nums">${it.price.toFixed(2)}</div>
                    </div>
                    <div className="mt-2 flex items-start gap-2 flex-wrap text-[12px]">
                      <span className="px-2 py-0.5 rounded bg-white/[0.05] text-muted border border-divider">Reason: <span className="text-ink">{it.reason}</span></span>
                      {it.note && (
                        <span className="px-2 py-0.5 rounded bg-warn/10 text-warn border border-warn/20 italic">"{it.note}"</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-divider text-[13px]">
                <span className="text-muted">Total estimated refund</span>
                <span className="text-ink font-semibold text-[15px] tabular-nums">${itemsTotal.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card title="Timeline">
            <div className="relative">
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-divider" />
              <div className="space-y-4">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 relative">
                    <div className="w-[22px] h-[22px] rounded-full grid place-content-center shrink-0 relative z-10 border-[3px] border-surface"
                         style={{ background: t.color }}>
                      <Icon name={t.icon} size={11} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink">{t.title}</span>
                        <span className="text-[11.5px] text-muted">·  {t.time}</span>
                      </div>
                      <div className="text-[12.5px] text-muted mt-0.5">{t.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Internal notes */}
          <Card title="Internal Notes" subtitle="Only visible to your team">
            <Textarea value={internalNote} onChange={e => setInternalNote(e.target.value)} placeholder="Add a private note…" rows={3} />
            <div className="flex justify-end mt-2.5">
              <Btn variant="secondary" icon="Plus" size="sm" onClick={handleAddNote} disabled={!internalNote.trim()}>Add Note</Btn>
            </div>
            {notes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-divider space-y-2.5">
                {notes.map(n => (
                  <div key={n.id} className="flex gap-2.5 text-[12.5px]">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent2 grid place-content-center text-[10px] font-bold shrink-0">YO</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-ink font-medium">{n.author}</span><span className="text-faint">{n.time}</span></div>
                      <div className="text-muted mt-0.5">{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-2 space-y-5">
          {/* Actions */}
          <Card title="Actions">
            {isPending && (
              <>
                <Btn variant="ok"            className="w-full" size="lg" icon="Check"   onClick={() => setApproveOpen(true)}>Approve Return</Btn>
                <Btn variant="danger-outline" className="w-full mt-2.5" size="lg" icon="X" onClick={() => setRejectOpen(true)}>Reject Return</Btn>
                <div className="mt-4 pt-4 border-t border-divider text-[12px] text-muted leading-relaxed">
                  Once approved, the customer will receive shipping instructions and a prepaid label.
                </div>
              </>
            )}
            {isApproved && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="PackageCheck" onClick={handleMarkReceived}>Mark as Received</Btn>
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info/10 border border-info/20 text-[12px] text-info flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>Waiting for customer to ship items back. Shipping label was sent on May 16.</div>
                </div>
              </>
            )}
            {isReceived && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon="DollarSign" onClick={openRefundModal}>Issue Refund</Btn>
                <div className="mt-3 text-[12px] text-muted">Items received and inspected. Ready to refund ${refund.toFixed(2)}.</div>
              </>
            )}
            {(r.status === 'REFUNDED' || r.status === 'REJECTED') && (
              <div className="px-3 py-3 rounded-md text-[12.5px]"
                   style={{ background: STATUS_STYLES[r.status].bg, color: STATUS_STYLES[r.status].text }}>
                This return is closed. No further actions available.
              </div>
            )}
          </Card>

          {/* Refund preview */}
          <Card title="Refund Preview">
            <div className="space-y-2 text-[13px]">
              <Row label="Items total"     value={`$${itemsTotal.toFixed(2)}`} />
              <Row label="Restocking fee"  value={`-$${restocking.toFixed(2)}`} muted />
              <div className="border-t border-divider my-2"></div>
              <Row label="Estimated refund" value={`$${refund.toFixed(2)}`} strong />
              <div className="flex items-center justify-between pt-1.5">
                <span className="text-[12px] text-muted">Customer requested</span>
                {(() => {
                  const m = REFUND_TYPES[r.refundType || 'ORIGINAL_PAYMENT'];
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: m.bg, color: m.color }}>
                      <Icon name={m.icon} size={11} /> {m.label}
                    </span>
                  );
                })()}
              </div>
              {r.refundType === 'STORE_CREDIT' && r.storeCreditBonus > 0 && (
                <div className="px-2.5 py-1.5 rounded-md text-[11.5px] flex items-start gap-1.5"
                     style={{ background: 'rgba(108,99,255,0.08)', color: '#8B85FF' }}>
                  <Icon name="Sparkles" size={11} className="mt-0.5" />
                  <span>+{r.storeCreditBonus}% bonus credit applied · total <strong className="text-ink">${(refund * (1 + r.storeCreditBonus / 100)).toFixed(2)}</strong></span>
                </div>
              )}
            </div>
          </Card>

          {/* Order info */}
          <Card title="Order Info">
            <div className="space-y-2.5 text-[13px]">
              <Row label="Order"          value={<a className="text-accent2 hover:text-white">{r.order}</a>} />
              <Row label="Placed"         value={r.orderDate} muted />
              <Row label="Total"          value={`$${r.orderTotal.toFixed(2)}`} />
              <Row label="Fulfilled"      value={r.fulfilled} muted />
              <div className="border-t border-divider my-1"></div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Return window</span>
                <span className="text-[12px] text-ok flex items-center gap-1.5">
                  <Icon name="CircleCheck" size={12} /> Expires Jun 28, 2026
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Modals */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Approve this return?"
             footer={<>
               <Btn variant="ghost" onClick={() => setApproveOpen(false)}>Cancel</Btn>
               <Btn variant="ok" icon="Check" onClick={handleApprove}>Approve & Send label</Btn>
             </>}>
        <div className="text-[13px] text-muted leading-relaxed">
          The customer will be emailed a prepaid return label and instructions. They have 14 days to ship the items back.
        </div>
        <div className="mt-4 p-3 rounded-md bg-bg/40 border border-divider text-[12.5px]">
          <div className="flex justify-between"><span className="text-muted">Refund amount</span><span className="text-ink font-semibold">${refund.toFixed(2)}</span></div>
          <div className="flex justify-between mt-1"><span className="text-muted">Method</span><span className="text-ink">Original payment</span></div>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject this return?"
             footer={<>
               <Btn variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Btn>
               <Btn variant="danger" icon="X" onClick={handleReject} disabled={!rejectReason.trim()}>Reject & Notify</Btn>
             </>}>
        <div className="text-[13px] text-muted leading-relaxed mb-3">
          The customer will be notified that their return cannot be accepted. Let them know why.
        </div>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Reason for rejection</label>
        <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4}
                  placeholder="e.g. Outside 30-day return window; items show signs of wear." />
      </Modal>

      {/* Process Refund modal */}
      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Process Refund" width="max-w-lg"
             footer={<>
               <Btn variant="ghost" onClick={() => setRefundOpen(false)}>Cancel</Btn>
               <Btn variant="primary" icon="DollarSign" onClick={handleRefund}>Confirm Refund</Btn>
             </>}>
        {(() => {
          const requested = REFUND_TYPES[r.refundType || 'ORIGINAL_PAYMENT'];
          const chosen = REFUND_TYPES[refundMethod];
          return (
            <div className="space-y-4">
              {/* Customer requested */}
              <div>
                <div className="text-[11px] uppercase tracking-wider text-faint font-semibold mb-1.5">Customer requested</div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md"
                     style={{ background: requested.bg, color: requested.color }}>
                  <Icon name={requested.icon} size={14} />
                  <span className="text-[13px] font-semibold">{requested.label}</span>
                </div>
              </div>

              {/* Override toggle */}
              <div className="p-3 rounded-md bg-bg/40 border border-divider">
                <Toggle checked={overrideMethod} onChange={(v) => { setOverrideMethod(v); if (!v) setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT'); }}
                        label="Override refund method"
                        description="Issue a different refund type than the customer requested." />
                {overrideMethod && (
                  <div className="mt-3 grid grid-cols-3 gap-2 animate-fadeIn">
                    {['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'EXCHANGE'].map(key => {
                      const m = REFUND_TYPES[key];
                      const sel = refundMethod === key;
                      return (
                        <button key={key} onClick={() => setRefundMethod(key)}
                          className={`text-left p-2.5 rounded-md border-2 transition ${sel ? 'border-accent bg-accent/10' : 'border-divider hover:border-[#3a3e58]'}`}>
                          <Icon name={m.icon} size={14} style={{ color: m.color }} />
                          <div className="text-[12px] font-semibold text-ink mt-1.5">{m.label}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="text-[11px] uppercase tracking-wider text-faint font-semibold block mb-1.5">Refund amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[14px]">$</span>
                  <input value={refundAmountStr} onChange={e => setRefundAmountStr(e.target.value)}
                         className="w-full h-10 pl-7 pr-3 text-[15px] rounded-md bg-bg border border-border text-ink font-semibold tabular-nums focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
                </div>
              </div>

              {/* Method-specific notes */}
              {refundMethod === 'STORE_CREDIT' && (
                <div className="p-3 rounded-md text-[12.5px] flex gap-2 items-start"
                     style={{ background: 'rgba(108,99,255,0.10)', color: '#8B85FF' }}>
                  <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed">
                    Store credit will be issued manually via Shopify admin (gift card or discount code). The customer is notified by email automatically.
                  </div>
                </div>
              )}
              {refundMethod === 'EXCHANGE' && (
                <div className="p-3 rounded-md text-[12.5px] flex gap-2 items-start"
                     style={{ background: 'rgba(59,130,246,0.10)', color: '#60a5fa' }}>
                  <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                  <div className="leading-relaxed">
                    The customer will receive an email to pick a replacement item. No refund is issued until the exchange is settled.
                  </div>
                </div>
              )}
              {refundMethod === 'ORIGINAL_PAYMENT' && (
                <div className="text-[12.5px] text-muted leading-relaxed">
                  Funds will be returned to the customer's card. Visa/Mastercard typically takes 5–10 business days.
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function Field({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} size={13} className="text-faint mt-1 shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-faint uppercase tracking-wide">{label}</div>
        <div className="text-[13px] text-ink truncate">{value}</div>
      </div>
    </div>
  );
}
function Row({ label, value, strong, muted }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted' : 'text-muted'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-ink font-semibold text-[15px]' : muted ? 'text-faint' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

window.ReturnDetailPage = ReturnDetailPage;
