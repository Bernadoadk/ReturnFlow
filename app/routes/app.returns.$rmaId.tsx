import { useState, useEffect } from "react";
import { Link, useLocation, useLoaderData, useFetcher } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon, StatusBadge, Btn, Card, Modal, Textarea, Toggle, useToast, STATUS_STYLES, Input } from "../components/ui";
import { REFUND_TYPES } from "../components/mock-data";
import { sendReturnEmail } from "../lib/mailer.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

  const returnRequest = await prisma.returnRequest.findUnique({
    where: { rma: rmaId, shop },
    include: { items: true, notes: { orderBy: { createdAt: 'desc' } }, settings: true }
  });

  if (!returnRequest) {
    throw new Response("Not Found", { status: 404 });
  }

  return { returnRequest };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const { rmaId } = params;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_status") {
    const status = formData.get("status") as string;
    const reason = formData.get("reason") as string | null;
    const carrier = formData.get("carrier") as string | null;
    const trackingNumber = formData.get("trackingNumber") as string | null;
    const labelUrl = formData.get("labelUrl") as string | null;

    const rr = await prisma.returnRequest.findUnique({ where: { rma: rmaId, shop }, include: { settings: true } });
    if (!rr) return { error: "Not found" };

    await prisma.returnRequest.update({
      where: { rma: rmaId, shop },
      data: {
        status,
        ...(reason && { rejectionReason: reason }),
        ...(carrier && { carrier }),
        ...(trackingNumber && { trackingNumber }),
        ...(labelUrl && { labelUrl })
      }
    });

    // Send email
    if (status === 'APPROVED') {
      await sendReturnEmail("Approved", {
        to: rr.customerEmail,
        fromEmail: rr.settings?.fromEmail,
        customer_name: rr.customerName || rr.customerEmail.split('@')[0],
        rma_number: rr.rma,
        order_number: rr.orderName,
        refund_amount: `$${rr.refundAmount.toFixed(2)}`,
        label_url: labelUrl || undefined
      });
    } else if (status === 'REJECTED') {
      await sendReturnEmail("Rejected", {
        to: rr.customerEmail,
        fromEmail: rr.settings?.fromEmail,
        customer_name: rr.customerName || rr.customerEmail.split('@')[0],
        rma_number: rr.rma,
        order_number: rr.orderName,
        rejection_reason: reason || 'N/A'
      });
    }

  } else if (intent === "process_refund") {
    const refundMethod = formData.get("refundMethod") as string;
    const refundAmount = parseFloat(formData.get("refundAmount") as string);

    const rr = await prisma.returnRequest.findUnique({
      where: { rma: rmaId, shop },
      include: { items: true, settings: true }
    });
    if (!rr) return { error: "Not found" };

    let storeCreditCode: string | null = null;

    if (refundMethod === 'ORIGINAL_PAYMENT') {
      // --- Real Shopify refund via refundCreate ---
      try {
        // 1. Fetch order transactions to get the parent transaction ID
        const orderRes = await admin.graphql(`#graphql
          query GetOrderTransactions($id: ID!) {
            order(id: $id) {
              transactions {
                id
                kind
                status
                amountSet { shopMoney { amount currencyCode } }
                gateway
              }
              lineItems(first: 50) {
                edges { node { id variant { id } quantity } }
              }
            }
          }`, { variables: { id: rr.orderId } });
        const orderData = await orderRes.json();
        const order = orderData.data?.order;

        if (order) {
          // Find the original SALE transaction
          const saleTx = order.transactions?.find(
            (t: any) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS'
          );

          // Build refundLineItems — match our stored items to Shopify line items by variantId
          const shopifyLineItems: any[] = order.lineItems?.edges?.map((e: any) => e.node) || [];
          const refundLineItems = rr.items
            .map((it: any) => {
              // Try lineItemId first, fallback to variantId match
              let shopifyItem = it.lineItemId
                ? shopifyLineItems.find((li: any) => li.id === it.lineItemId)
                : shopifyLineItems.find((li: any) => li.variant?.id === it.variantId);
              if (!shopifyItem) return null;
              return {
                lineItemId: shopifyItem.id,
                quantity: it.quantity,
                restockType: "RETURN"
              };
            })
            .filter(Boolean);

          if (saleTx && refundLineItems.length > 0) {
            const refundInput: any = {
              orderId: rr.orderId,
              refundLineItems,
              transactions: [{
                parentId: saleTx.id,
                amount: refundAmount.toFixed(2),
                kind: "REFUND",
                gateway: saleTx.gateway
              }],
              notify: true
            };
            const refundRes = await admin.graphql(`#graphql
              mutation RefundCreate($input: RefundInput!) {
                refundCreate(input: $input) {
                  refund { id createdAt }
                  userErrors { field message }
                }
              }`, { variables: { input: refundInput } });
            const refundData = await refundRes.json();
            const userErrors = refundData.data?.refundCreate?.userErrors || [];
            if (userErrors.length > 0) {
              console.error("[refund] Shopify refundCreate errors:", JSON.stringify(userErrors));
              return { error: `Shopify refund error: ${userErrors.map((e: any) => e.message).join(', ')}` };
            }
            console.log("[refund] Shopify refund created:", refundData.data?.refundCreate?.refund?.id);
          } else {
            // No matching transaction or line items — log but don't block
            console.warn("[refund] Could not match transaction/line items for automatic refund. Marking manually.");
          }
        }
      } catch (e: any) {
        console.error("[refund] refundCreate exception:", e?.message || e);
        return { error: `Failed to issue refund: ${e?.message || 'unknown error'}` };
      }

    } else if (refundMethod === 'STORE_CREDIT') {
      try {
        const discountCode = `CREDIT-${rmaId}`;
        const createDiscountRes = await admin.graphql(`#graphql
          mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
              codeDiscountNode {
                codeDiscount {
                  ... on DiscountCodeBasic {
                    codes(first: 1) { edges { node { code } } }
                  }
                }
              }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              basicCodeDiscount: {
                title: "Store Credit " + rmaId,
                code: discountCode,
                customerSelection: { all: true },
                customerGets: {
                  value: { discountAmount: { amount: refundAmount, appliesOnEachItem: false } },
                  items: { all: true }
                },
                startsAt: new Date().toISOString()
              }
            }
          }
        );
        const discountData = await createDiscountRes.json();
        const userErrors = discountData.data?.discountCodeBasicCreate?.userErrors || [];
        if (userErrors.length === 0) {
          storeCreditCode = discountData.data?.discountCodeBasicCreate?.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code || discountCode;
        } else {
          console.error("[refund] Discount code errors:", JSON.stringify(userErrors));
        }
      } catch (e) {
        console.error("[refund] Failed to create discount code", e);
      }
    }
    // EXCHANGE: no monetary refund, handled manually by merchant

    await prisma.returnRequest.update({
      where: { rma: rmaId, shop },
      data: { status: "REFUNDED", refundType: refundMethod, refundAmount }
    });

    await sendReturnEmail("Refunded", {
      to: rr.customerEmail,
      shop,
      fromEmail: rr.settings?.fromEmail,
      customer_name: rr.customerName || rr.customerEmail.split('@')[0],
      rma_number: rr.rma,
      order_number: rr.orderName,
      refund_amount: `$${refundAmount.toFixed(2)}`,
      store_credit_code: storeCreditCode || undefined
    });

  } else if (intent === "add_note") {
    const text = formData.get("text") as string;
    const rr = await prisma.returnRequest.findUnique({ where: { rma: rmaId, shop } });
    if (rr) {
      await prisma.internalNote.create({
        data: {
          returnRequestId: rr.id,
          text,
          author: "Admin"
        }
      });
    }
  }

  return { success: true };
};

export default function ReturnDetailPage() {
  const { returnRequest } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const toast = useToast();

  const r = returnRequest;

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [refundOpen,  setRefundOpen]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [overrideMethod, setOverrideMethod] = useState(false);
  const [refundMethod, setRefundMethod] = useState(r.refundType || 'ORIGINAL_PAYMENT');
  const [refundAmountStr, setRefundAmountStr] = useState((r.refundAmount || 0).toFixed(2));
  
  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      const data = fetcher.data as any;
      const fd = fetcher.formData as FormData | undefined;
      if (data.success && fd?.get("intent") === "add_note") {
        setInternalNote('');
        toast({ kind: 'info', title: 'Note added' });
      } else if (data.success && fd?.get("intent") === "update_status") {
        const status = fd?.get("status");
        if (status === 'APPROVED') {
          setApproveOpen(false);
          toast({ kind: 'success', title: 'Return approved', body: `${r.rma} — shipping label dispatched.` });
        } else if (status === 'REJECTED') {
          setRejectOpen(false);
          setRejectReason('');
          toast({ kind: 'error', title: 'Return rejected', body: 'Customer has been notified.' });
        } else if (status === 'RECEIVED') {
          toast({ kind: 'success', title: 'Marked as received', body: 'Refund queue updated.' });
        }
      } else if (data.success && fd?.get("intent") === "process_refund") {
        setRefundOpen(false);
        const methodLabel = REFUND_TYPES[refundMethod as string]?.label || 'Refund';
        toast({ kind: 'success', title: 'Refund issued', body: `${methodLabel} — $${parseFloat(refundAmountStr || '0').toFixed(2)} to ${r.customerName}.` });
      }
    }
  }, [fetcher.data, fetcher.state, fetcher.formData, r.rma, r.customerName, refundMethod, refundAmountStr, toast]);

  const itemsTotal = r.items.reduce((s: number, it: any) => s + it.price * it.quantity, 0);
  const restocking = 0;
  const refund = itemsTotal - restocking;
  const isPending  = r.status === 'PENDING';
  const isApproved = r.status === 'APPROVED';
  const isReceived = r.status === 'RECEIVED';

  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [labelUrl, setLabelUrl] = useState('');

  const handleApprove = () => {
    fetcher.submit({
      intent: 'update_status',
      status: 'APPROVED',
      carrier,
      trackingNumber,
      labelUrl
    }, { method: 'POST' });
  };
  const handleReject = () => {
    if (!rejectReason.trim()) return;
    fetcher.submit({ intent: 'update_status', status: 'REJECTED', reason: rejectReason }, { method: 'POST' });
  };
  const handleMarkReceived = () => {
    fetcher.submit({ intent: 'update_status', status: 'RECEIVED' }, { method: 'POST' });
  };
  const openRefundModal = () => {
    let creditTotal = refund;
    if (r.refundType === 'STORE_CREDIT' && r.settings.incentivizeStoreCredit) {
      creditTotal = refund * (1 + r.settings.storeCreditBonusPercent / 100);
    }
    
    setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT');
    setOverrideMethod(false);
    setRefundAmountStr(creditTotal.toFixed(2));
    setRefundOpen(true);
  };
  const handleRefund = () => {
    fetcher.submit({ intent: 'process_refund', refundMethod, refundAmount: refundAmountStr }, { method: 'POST' });
  };
  const handleAddNote = () => {
    if (!internalNote.trim()) return;
    fetcher.submit({ intent: 'add_note', text: internalNote.trim() }, { method: 'POST' });
  };

  const timeline = [
    { kind: 'request', title: 'Return Requested', detail: 'Customer submitted return request', time: new Date(r.createdAt).toLocaleString(), icon: 'PackagePlus', color: '#22C55E' },
  ];
  if (r.status === 'APPROVED' || r.status === 'RECEIVED' || r.status === 'REFUNDED') {
    timeline.push({ kind: 'approved', title: 'Return Approved', detail: 'Shipping instructions sent', time: new Date(r.updatedAt).toLocaleString(), icon: 'CircleCheck', color: '#3B82F6' });
  }
  if (r.status === 'REJECTED') {
    timeline.push({ kind: 'rejected', title: 'Return Rejected', detail: r.rejectionReason || 'No reason provided', time: new Date(r.updatedAt).toLocaleString(), icon: 'CircleX', color: '#EF4444' });
  }
  if (r.status === 'RECEIVED' || r.status === 'REFUNDED') {
    timeline.push({ kind: 'received', title: 'Items Received', detail: 'Items confirmed at warehouse', time: new Date(r.updatedAt).toLocaleString(), icon: 'PackageCheck', color: '#8B5CF6' });
  }
  if (r.status === 'REFUNDED') {
    timeline.push({ kind: 'refunded', title: 'Refund Issued', detail: `${REFUND_TYPES[r.refundType as string]?.label} · $${r.refundAmount.toFixed(2)}`, time: new Date(r.updatedAt).toLocaleString(), icon: 'DollarSign', color: '#22C55E' });
  }

  return (
    <div>
      <Link to={`/app/returns${location.search}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition mb-4 group">
        <Icon name="ArrowLeft" size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Returns
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold text-ink tracking-tight font-mono">{r.rma}</h1>
            <StatusBadge status={r.status} size="lg" />
          </div>
          <div className="text-[13px] text-muted mt-1.5">Submitted {new Date(r.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`mailto:${r.customerEmail}?subject=Your return ${r.rma} — ${r.orderName}`}>
            <Btn variant="secondary" icon="MessageCircle" size="sm">Message customer</Btn>
          </a>
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
                {r.customerName ? r.customerName.split(' ').map((p: string) => p[0]).slice(0,2).join('').toUpperCase() : r.customerEmail[0].toUpperCase()}
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
                <div className="col-span-2">
                  <div className="text-ink font-semibold text-[14px]">{r.customerName || r.customerEmail.split('@')[0]}</div>
                </div>
                <Field icon="Mail"     label="Email"        value={r.customerEmail} />
                <Field icon="Phone"    label="Phone"        value={r.customerPhone || 'N/A'} />
                <Field icon="Receipt"  label="Order"        value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
                <Field icon="Calendar" label="Date"         value={new Date(r.orderDate).toLocaleDateString()} />
              </div>
            </div>
          </Card>

          {/* Items */}
          <Card title="Items Requested" subtitle={`${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}`}>
            <div className="space-y-3">
              {r.items.map((it: any, i: number) => (
                <div key={i} className="flex gap-4 p-3 rounded-md bg-bg/40 border border-divider">
                  <div className="w-16 h-16 rounded-md grid place-content-center shrink-0 relative overflow-hidden bg-[#f8fafc]">
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt={it.name} className="w-full h-full object-cover" />
                    ) : (
                      <Icon name="Shirt" size={22} className="text-[#ccc]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-[13.5px] font-semibold text-ink">{it.name}</div>
                        <div className="text-[12px] text-muted mt-0.5">{it.variantName} · Qty {it.quantity}</div>
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
                <span className="text-muted">Total items value</span>
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
            <Textarea value={internalNote} onChange={(e: any) => setInternalNote(e.target.value)} placeholder="Add a private note…" rows={3} />
            <div className="flex justify-end mt-2.5">
              <Btn variant="secondary" icon="Plus" size="sm" onClick={handleAddNote} disabled={!internalNote.trim() || fetcher.state !== 'idle'}>Add Note</Btn>
            </div>
            {r.notes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-divider space-y-2.5">
                {r.notes.map((n: any) => (
                  <div key={n.id} className="flex gap-2.5 text-[12.5px]">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent2 grid place-content-center text-[10px] font-bold shrink-0">AD</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-ink font-medium">{n.author}</span><span className="text-faint">{new Date(n.createdAt).toLocaleString()}</span></div>
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
                <Btn variant="ok"            className="w-full" size="lg" icon="Check"   onClick={() => setApproveOpen(true)} disabled={fetcher.state !== 'idle'}>Approve Return</Btn>
                <Btn variant="danger-outline" className="w-full mt-2.5" size="lg" icon="X" onClick={() => setRejectOpen(true)} disabled={fetcher.state !== 'idle'}>Reject Return</Btn>
                <div className="mt-4 pt-4 border-t border-divider text-[12px] text-muted leading-relaxed">
                  Once approved, the customer will receive shipping instructions and a prepaid label.
                </div>
              </>
            )}
            {isApproved && (
              <>
                <Btn variant="primary" className="w-full" size="lg" icon="PackageCheck" onClick={handleMarkReceived} disabled={fetcher.state !== 'idle'}>Mark as Received</Btn>
                <div className="mt-3 px-3 py-2.5 rounded-md bg-info/10 border border-info/20 text-[12px] text-info flex items-start gap-2">
                  <Icon name="Truck" size={14} className="mt-0.5 shrink-0" />
                  <div>Waiting for customer to ship items back.</div>
                </div>
              </>
            )}
            {isReceived && (
              <>
                <Btn variant="ok" className="w-full" size="lg" icon="DollarSign" onClick={openRefundModal}>Issue Refund</Btn>
                <div className="mt-3 text-[12px] text-muted">Items received and inspected. Ready to refund.</div>
              </>
            )}
            {(r.status === 'REFUNDED' || r.status === 'REJECTED') && (
              <div className="px-3 py-3 rounded-md text-[12.5px]"
                   style={{ background: STATUS_STYLES[r.status]?.bg || '#333', color: STATUS_STYLES[r.status]?.text || '#fff' }}>
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
                  const m = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: m.bg, color: m.color }}>
                      <Icon name={m.icon} size={11} /> {m.label}
                    </span>
                  );
                })()}
              </div>
              {r.refundType === 'STORE_CREDIT' && r.settings.incentivizeStoreCredit && r.settings.storeCreditBonusPercent > 0 && (
                <div className="px-2.5 py-1.5 rounded-md text-[11.5px] flex items-start gap-1.5"
                     style={{ background: 'rgba(108,99,255,0.08)', color: '#8B85FF' }}>
                  <Icon name="Sparkles" size={11} className="mt-0.5" />
                  <span>+{r.settings.storeCreditBonusPercent}% bonus credit applied · total <strong className="text-ink">${(refund * (1 + r.settings.storeCreditBonusPercent / 100)).toFixed(2)}</strong></span>
                </div>
              )}
            </div>
          </Card>

          {/* Order info */}
          <Card title="Order Info">
            <div className="space-y-2.5 text-[13px]">
              <Row label="Order"          value={<a className="text-accent2 hover:text-white cursor-pointer">{r.orderName}</a>} />
              <Row label="Total"          value={`$${r.orderTotal.toFixed(2)}`} />
              {r.carrier && <Row label="Carrier"       value={r.carrier} />}
              {r.trackingNumber && <Row label="Tracking"     value={r.trackingNumber} />}
              {r.labelUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Shipping Label</span>
                  <a href={r.labelUrl} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1.5 text-accent2 hover:underline text-[12.5px] font-medium">
                    <Icon name="Download" size={13} /> Download label
                  </a>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Modals */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="Approve this return?"
             footer={<>
               <Btn variant="ghost" onClick={() => setApproveOpen(false)}>Cancel</Btn>
               <Btn variant="ok" icon="Check" onClick={handleApprove} disabled={fetcher.state !== 'idle'}>Approve & Send instructions</Btn>
             </>}>
        <div className="space-y-4">
          <div className="text-[13px] text-muted leading-relaxed">
            The customer will be emailed shipping instructions. You can optionally provide tracking details below.
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Carrier</label>
              <Input value={carrier} onChange={(e: any) => setCarrier(e.target.value)} placeholder="e.g. FedEx" />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted block mb-1.5">Tracking Number</label>
              <Input value={trackingNumber} onChange={(e: any) => setTrackingNumber(e.target.value)} placeholder="e.g. 1Z999..." />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-muted block mb-1.5">Prepaid Shipping Label URL <span className="text-faint font-normal">(optional — sent to customer)</span></label>
            <Input value={labelUrl} onChange={(e: any) => setLabelUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject this return?"
             footer={<>
               <Btn variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Btn>
               <Btn variant="danger" icon="X" onClick={handleReject} disabled={!rejectReason.trim() || fetcher.state !== 'idle'}>Reject & Notify</Btn>
             </>}>
        <div className="text-[13px] text-muted leading-relaxed mb-3">
          The customer will be notified that their return cannot be accepted. Let them know why.
        </div>
        <label className="text-[12px] font-medium text-muted block mb-1.5">Reason for rejection</label>
        <Textarea value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} rows={4}
                  placeholder="e.g. Outside 30-day return window; items show signs of wear." />
      </Modal>

      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Process Refund" width="max-w-lg"
             footer={<>
               <Btn variant="ghost" onClick={() => setRefundOpen(false)}>Cancel</Btn>
               <Btn variant="primary" icon="DollarSign" onClick={handleRefund} disabled={fetcher.state !== 'idle'}>Confirm Refund</Btn>
             </>}>
        {(() => {
          const requested = REFUND_TYPES[r.refundType as string] || REFUND_TYPES['ORIGINAL_PAYMENT'];
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
                <Toggle checked={overrideMethod} onChange={(v: boolean) => { setOverrideMethod(v); if (!v) setRefundMethod(r.refundType || 'ORIGINAL_PAYMENT'); }}
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
                    A discount code will be created in Shopify for the amount. The customer can use it at checkout.
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function Field({ icon, label, value }: any) {
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
function Row({ label, value, strong, muted }: any) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted' : 'text-muted'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-ink font-semibold text-[15px]' : muted ? 'text-faint' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
