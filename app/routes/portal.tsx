import React, { useState, useMemo, useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Icon } from "../components/ui";
import { REFUND_TYPES } from "../components/mock-data";
import { sendReturnEmail } from "../lib/mailer.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shop = "";
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session) {
      shop = session.shop;
    } else {
      // App Proxy verified the HMAC but returned no session — read shop from query param
      const url = new URL(request.url);
      shop = url.searchParams.get("shop") || "";
    }
  } catch (e) {
    // Local dev fallback — NOT for production
    if (process.env.NODE_ENV !== "production") {
      const url = new URL(request.url);
      shop = url.searchParams.get("shop") || "example.myshopify.com";
    } else {
      // In production, reject unauthenticated requests
      throw new Response("Unauthorized", { status: 401 });
    }
  }

  let settings = await prisma.shopSettings.findUnique({
    where: { shop },
    include: { reasons: true }
  });

  if (!settings) {
    settings = {
      brandColor: "#6C63FF",
      logoUrl: null,
      returnPolicy: "",
      allowStoreCredit: true,
      allowExchanges: true,
      storeCreditBonusPercent: 10,
      incentivizeStoreCredit: true,
      reasons: [{ label: "Does not fit", enabled: true }, { label: "Changed my mind", enabled: true }],
      returnAddress: "Returns Dept",
      shop: shop
    } as any;
  }

  return { settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "example.myshopify.com";
  let admin: any = null;
  try {
    const proxyAuth = await authenticate.public.appProxy(request);
    if (proxyAuth && proxyAuth.session) {
      shop = proxyAuth.session.shop;
      admin = proxyAuth.admin;
    }
  } catch (e) {
    const url = new URL(request.url);
    const shopParam = url.searchParams.get("shop");
    if (shopParam) {
      shop = shopParam;
      try {
        const { unauthenticated } = await import("../shopify.server");
        const result = await unauthenticated.admin(shop);
        admin = result.admin;
        console.log("[portal] action: unauthenticated.admin succeeded for", shop);
      } catch (authErr: any) {
        console.error("[portal] action: unauthenticated.admin failed:", authErr?.message || authErr);
      }
    }
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

    if (intent === "find_order") {
      const orderNum = (formData.get("orderNum") as string).trim();
      const email = (formData.get("email") as string).trim().toLowerCase();

      if (!admin) {
        return { error: `Store session not found for ${shop}. Please open the app from your Shopify admin first.` };
      }

      try {
        const simpleOrderNum = orderNum.replace(/^#/, "").trim();

        const ORDER_QUERY = `#graphql
          query FindOrder($query: String!) {
            orders(first: 20, query: $query) {
              edges {
                node {
                  id
                  name
                  email
                  createdAt
                  displayFulfillmentStatus
                  customer { firstName lastName }
                  totalPriceSet { shopMoney { amount } }
                  lineItems(first: 50) {
                    edges {
                      node {
                        id
                        title
                        variantTitle
                        quantity
                        image { url }
                        product { id }
                        variant { id }
                        discountedTotalSet { shopMoney { amount } }
                      }
                    }
                  }
                }
              }
            }
          }`;

        // Strategy 1: query by email (exact, reliable) then filter by order name in JS
        // Strategy 2: fallback — query by name (various formats) then filter by email in JS
        let orderNode: any = null;
        const debugLines: string[] = [];

        const runQuery = async (q: string) => {
          const resp = await admin.graphql(ORDER_QUERY, { variables: { query: q } });
          const json = await resp.json();
          if (json.errors) {
            const msg = JSON.stringify(json.errors);
            console.error(`[portal] GraphQL errors for q="${q}":`, msg);
            debugLines.push(`q="${q}" → GraphQL error: ${msg}`);
            return [];
          }
          const edges = json.data?.orders?.edges || [];
          console.log(`[portal] q="${q}" → ${edges.length} result(s)`);
          debugLines.push(`q="${q}" → ${edges.length} result(s)`);
          return edges;
        };

        // --- Email-first approach ---
        const byEmail = await runQuery(`email:${email}`);
        if (byEmail.length > 0) {
          const match = byEmail.find((e: any) =>
            e.node.name.replace(/^#/, "").trim() === simpleOrderNum
          );
          if (match) { orderNode = match.node; }
          else {
            const found = byEmail.map((e: any) => e.node.name).join(", ");
            debugLines.push(`email match found orders [${found}] but none is #${simpleOrderNum}`);
          }
        }

        // --- Fallback: name-based queries ---
        if (!orderNode) {
          const nameQueries = [
            `name:#${simpleOrderNum}`,
            `name:${simpleOrderNum}`,
            `name:"#${simpleOrderNum}"`,
          ];
          for (const q of nameQueries) {
            const edges = await runQuery(q);
            if (edges.length > 0) {
              const match = edges.find((e: any) =>
                e.node.email?.toLowerCase().trim() === email
              );
              if (match) {
                orderNode = match.node;
                break;
              } else {
                const found = edges.map((e: any) => `${e.node.name}/${e.node.email ?? 'no-email'}`).join(", ");
                debugLines.push(`name match found [${found}] but email mismatch (expected: ${email})`);
              }
            }
          }
        }

        // --- Diagnostic: show recent orders if nothing found at all ---
        if (!orderNode) {
          try {
            const diagResp = await admin.graphql(`#graphql
              query DiagRecentOrders {
                orders(first: 5, sortKey: CREATED_AT, reverse: true) {
                  edges { node { name email } }
                }
              }`);
            const diagJson = await diagResp.json();
            const diagEdges = diagJson.data?.orders?.edges || [];
            if (diagEdges.length > 0) {
              const recent = diagEdges.map((e: any) =>
                `${e.node.name}/${e.node.email ?? 'no-email'}`
              ).join(" | ");
              console.log("[portal] Recent store orders:", recent);
              debugLines.push(`Recent store orders: ${recent}`);
            } else {
              console.log("[portal] No orders found in store at all");
              debugLines.push("No orders in store");
            }
          } catch (_diagErr) { /* ignore diag errors */ }

          const devHint = process.env.NODE_ENV !== "production"
            ? ` — Debug: ${debugLines.join("; ")}`
            : "";
          return { error: `Order not found. Please check your order number and email address.${devHint}` };
        }

        // Fetch shop settings for blocklist + return window
        const actionSettings = await prisma.shopSettings.findUnique({ where: { shop } });

        // Parse blocklist from settings (comma-separated SKUs / product IDs)
        const blockedSkusRaw = actionSettings?.blockedSkus ?? "";
        const blockedList = blockedSkusRaw
          .split(",")
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);

        // Check if order is fulfilled (warn if not)
        const isFulfilled = orderNode.displayFulfillmentStatus !== 'UNFULFILLED';

        const items = orderNode.lineItems.edges
          .filter((edge: any) => edge.node.product && edge.node.variant)
          .map((edge: any) => {
            const n = edge.node;
            const productId = n.product.id?.toLowerCase() ?? "";
            // Check if this item is blocked
            const isBlocked = blockedList.some(
              (b: string) => productId.includes(b) || (n.sku && n.sku.toLowerCase() === b)
            );
            return {
              id: n.id,
              productId: n.product.id,
              variantId: n.variant.id,
              name: n.title,
              variant: n.variantTitle || "Default Title",
              quantity: n.quantity,
              price: parseFloat(n.discountedTotalSet.shopMoney.amount) / n.quantity,
              image: n.image?.url || null,
              blocked: isBlocked,
            };
          });

        // --- Return window validation ---
        const returnWindow = actionSettings?.returnWindow ?? 30;
        const orderDate = new Date(orderNode.createdAt);
        const daysSinceOrder = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceOrder > returnWindow) {
          return {
            error: `This order is outside the ${returnWindow}-day return window (ordered ${daysSinceOrder} days ago). Please contact support if you need assistance.`
          };
        }

        const firstName = orderNode.customer?.firstName || '';
        const lastName  = orderNode.customer?.lastName  || '';
        const customerName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];

        return {
          order: {
            id: orderNode.id,
            name: orderNode.name,
            email: orderNode.email,
            createdAt: orderNode.createdAt,
            customerName,
            orderTotal: parseFloat(orderNode.totalPriceSet.shopMoney.amount),
            isFulfilled,
            items
          }
        };
      } catch (e: any) {
        console.error("[portal] find_order exception:", e);
        return { error: `An error occurred: ${e?.message || "unknown error"}` };
      }
    }

  if (intent === "submit_return") {
    const orderId = formData.get("orderId") as string;
    const orderName = formData.get("orderName") as string;
    const email = formData.get("email") as string;
    const customerName = (formData.get("customerName") as string) || email.split('@')[0];
    const orderDateStr = formData.get("orderDate") as string;
    const orderTotal = parseFloat(formData.get("orderTotal") as string) || 0;
    const refundType = formData.get("refundType") as string;
    const totalRefund = parseFloat(formData.get("totalRefund") as string);
    const exchangeNote = (formData.get("exchangeNote") as string) || null;
    const selectedItemsStr = formData.get("selectedItems") as string;
    const selectedItems = JSON.parse(selectedItemsStr);

    // Blocklist check: reject if any selected item is blocked
    const shopSettings2 = await prisma.shopSettings.findUnique({ where: { shop } });
    if (shopSettings2?.blockedSkus) {
      const blocked = shopSettings2.blockedSkus
        .split(",")
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean);
      const blockedItem = selectedItems.find((it: any) =>
        blocked.some(
          (b: string) => it.productId?.toLowerCase().includes(b) || (it.sku && it.sku.toLowerCase() === b)
        )
      );
      if (blockedItem) {
        return { error: `"${blockedItem.name}" is not eligible for return. Please contact support for assistance.` };
      }
    }

    const year = new Date().getFullYear();
    const lastRma = await prisma.returnRequest.findFirst({
      where: { shop, rma: { startsWith: `RMA-${year}-` } },
      orderBy: { createdAt: 'desc' },
      select: { rma: true }
    });
    const lastSeq = lastRma ? parseInt(lastRma.rma.split('-')[2] || '0', 10) : 0;
    const nextSeq = (isNaN(lastSeq) ? 0 : lastSeq) + 1;
    const rma = `RMA-${year}-${String(nextSeq).padStart(6, '0')}`;

    const returnRequest = await prisma.returnRequest.create({
      data: {
        shop,
        rma,
        orderId,
        orderName,
        customerEmail: email,
        customerName,
        orderDate: orderDateStr ? new Date(orderDateStr) : new Date(),
        orderTotal,
        refundType,
        refundAmount: totalRefund,
        ...(exchangeNote && { exchangeNote }),
        items: {
          create: selectedItems.map((item: any) => ({
            lineItemId: item.lineItemId || null,
            productId: item.productId,
            variantId: item.variantId,
            name: item.name,
            variantName: item.variant,
            quantity: item.qty,
            price: item.price,
            reason: item.reason,
            note: item.note || "",
            imageUrl: item.image
          }))
        }
      }
    });

    const shopSettings = await prisma.shopSettings.findUnique({ where: { shop } });

    // Confirmation email to customer
    await sendReturnEmail("Request Received", {
      to: email,
      shop,
      fromEmail: shopSettings?.fromEmail,
      customer_name: customerName,
      rma_number: rma,
      order_number: orderName,
      item_count: selectedItems.length.toString(),
    });

    // Auto-approve if enabled
    if (shopSettings?.autoApprove) {
      await prisma.returnRequest.update({
        where: { rma, shop },
        data: { status: 'APPROVED' }
      });
      await sendReturnEmail("Approved", {
        to: email,
        shop,
        fromEmail: shopSettings.fromEmail,
        customer_name: customerName,
        rma_number: rma,
        order_number: orderName,
        refund_amount: `$${totalRefund.toFixed(2)}`,
      });
    }

    // Merchant notification if enabled
    if (shopSettings?.notifyMerchant && shopSettings.fromEmail) {
      await sendReturnEmail("Request Received", {
        to: shopSettings.fromEmail,
        shop,
        fromEmail: shopSettings.fromEmail,
        customer_name: customerName,
        rma_number: rma,
        order_number: orderName,
        item_count: selectedItems.length.toString(),
      });
    }

    return { success: true, rma: returnRequest.rma };
  }

  if (intent === "submit_tracking") {
    const rma = (formData.get("rma") as string).trim().toUpperCase();
    const email = (formData.get("email") as string).trim().toLowerCase();
    const carrier = (formData.get("carrier") as string).trim();
    const trackingNumber = (formData.get("trackingNumber") as string).trim();

    if (!rma || !email || !carrier || !trackingNumber) {
      return { trackingError: "Please fill in all fields." };
    }

    const rr = await prisma.returnRequest.findFirst({
      where: { shop, rma, customerEmail: email, status: 'APPROVED' },
      include: { settings: { select: { fromEmail: true } } }
    });

    if (!rr) {
      return { trackingError: "No approved return found with that RMA and email. Please check and try again." };
    }

    await prisma.returnRequest.update({
      where: { id: rr.id },
      data: { status: 'SHIPPED', shippedAt: new Date(), carrier, trackingNumber }
    });

    await sendReturnEmail("Shipped", {
      to: rr.customerEmail,
      shop,
      fromEmail: (rr as any).settings?.fromEmail ?? undefined,
      customer_name: rr.customerName || rr.customerEmail.split('@')[0],
      rma_number: rr.rma,
      order_number: rr.orderName,
      carrier,
      tracking_number: trackingNumber,
    });

    return { trackingSuccess: true, trackingRma: rma };
  }

  return null;
};

export default function PortalPage() {
  const { settings, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  
  const [step, setStep] = useState(1);
  const [orderNum, setOrderNum] = useState('');
  const [email, setEmail] = useState('');
  const [orderData, setOrderData] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, { qty: number }>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refundType, setRefundType] = useState('ORIGINAL_PAYMENT');
  const [exchangeNote, setExchangeNote] = useState('');
  const [submittedRma, setSubmittedRma] = useState<string | null>(null);
  const [trackingSubmitted, setTrackingSubmitted] = useState(false);

  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      const data = fetcher.data as any;
      if (data.order && step === 1) {
        setOrderData(data.order);
        setStep(2);
      }
      if (data.success && data.rma && step === 5) {
        setSubmittedRma(data.rma);
      }
      if (data.trackingSuccess) {
        setTrackingSubmitted(true);
      }
    }
  }, [fetcher.data, fetcher.state, step]);

  const availableRefundTypes = useMemo(() => {
    const list = ['ORIGINAL_PAYMENT'];
    if (settings?.allowStoreCredit) list.push('STORE_CREDIT');
    if (settings?.allowExchanges) list.push('EXCHANGE');
    return list;
  }, [settings?.allowStoreCredit, settings?.allowExchanges]);

  const showRefundStep = availableRefundTypes.length > 1;
  const STEPS = showRefundStep
    ? ['Find Order', 'Select Items', 'Reason', 'Refund Type', 'Confirm']
    : ['Find Order', 'Select Items', 'Reason', 'Confirm'];

  const confirmStep = STEPS.length;

  const itemsList = Object.entries(selectedItems)
    .filter(([_, v]) => v.qty > 0)
    .map(([id]) => orderData?.items.find((i: any) => i.id === id)!);

  const totalRefund = itemsList.reduce((s, it) => s + (it.price * (selectedItems[it.id]?.qty || 0)), 0);

  const canContinue: Record<number, boolean> = {
    1: !!(orderNum.trim() && email.trim().includes('@')),
    2: itemsList.length > 0,
    3: itemsList.every(i => reasons[i.id]),
    4: !!refundType,
  };

  const go = (n: number) => setStep(n);
  const nextFrom = (current: number) => {
    if (current === 3) return showRefundStep ? 4 : confirmStep;
    if (current === 4) return confirmStep;
    return current + 1;
  };
  const prevFrom = (current: number) => {
    if (current === confirmStep) return showRefundStep ? 4 : 3;
    if (current === 4) return 3;
    return current - 1;
  };

  if (submittedRma) {
    return (
      <PortalShell settings={settings} shop={shop}>
        <PortalConfirmation rma={submittedRma} email={email} refundType={refundType} onReset={() => { 
          setSubmittedRma(null); setStep(1); setOrderNum(''); setEmail(''); setOrderData(null); setSelectedItems({}); setReasons({}); setNotes({}); setRefundType('ORIGINAL_PAYMENT'); 
        }} />
      </PortalShell>
    );
  }

  const stepperCurrent = step === confirmStep ? STEPS.length : step;

  const handleFindOrder = () => {
    fetcher.submit({ intent: 'find_order', orderNum, email }, { method: 'POST' });
  };

  const handleSubmitReturn = () => {
    const itemsToSubmit = itemsList.map(item => ({
      lineItemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variant: item.variant,
      qty: selectedItems[item.id].qty,
      price: item.price,
      reason: reasons[item.id],
      note: notes[item.id],
      image: item.image
    }));

    fetcher.submit({
      intent: 'submit_return',
      orderId: orderData.id,
      orderName: orderData.name,
      email: orderData.email,
      customerName: orderData.customerName || '',
      orderDate: orderData.createdAt,
      orderTotal: (orderData.orderTotal ?? totalRefund).toString(),
      refundType,
      exchangeNote,
      totalRefund: totalRefund.toString(),
      selectedItems: JSON.stringify(itemsToSubmit)
    }, { method: 'POST' });
  };

  return (
    <PortalShell settings={settings} shop={shop}>
      <Stepper steps={STEPS} current={stepperCurrent} onJump={(i: number) => {
        const target = i + 1;
        if (target < stepperCurrent) {
          if (target === STEPS.length) go(confirmStep);
          else go(target);
        }
      }} />

      <div className="bg-white rounded-2xl border border-[#e6e6ec] shadow-[0_4px_24px_rgba(15,17,23,0.06)] p-6 sm:p-8 mt-6">
        {step === 1 && (
          <StepFindOrder orderNum={orderNum} setOrderNum={setOrderNum} email={email} setEmail={setEmail}
                         onNext={handleFindOrder} canContinue={canContinue[1]} isLoading={fetcher.state !== 'idle'}
                         error={(fetcher.data as any)?.error} shop={shop}
                         fetcher={fetcher} trackingSubmitted={trackingSubmitted}
                         onTrackingReset={() => setTrackingSubmitted(false)} />
        )}
        {step === 2 && orderData && (
          <StepSelectItems items={orderData.items} orderName={orderData.name} date={orderData.createdAt}
                           isFulfilled={orderData.isFulfilled}
                           selectedItems={selectedItems} setSelectedItems={setSelectedItems}
                           onBack={() => go(1)} onNext={() => canContinue[2] && go(3)} canContinue={canContinue[2]} />
        )}
        {step === 3 && (
          <StepReasons itemsList={itemsList} reasons={reasons} setReasons={setReasons}
                       notes={notes} setNotes={setNotes}
                       exchangeNote={exchangeNote} setExchangeNote={setExchangeNote}
                       refundType={refundType}
                       totalSteps={STEPS.length}
                       reasonOptions={(settings?.reasons ?? []).filter((r: any) => r.enabled).map((r: any) => r.label)}
                       onBack={() => go(prevFrom(3))} onNext={() => canContinue[3] && go(nextFrom(3))} canContinue={canContinue[3]} />
        )}
        {step === 4 && showRefundStep && (
          <StepRefundType availableRefundTypes={availableRefundTypes}
            refundType={refundType} setRefundType={setRefundType}
            totalRefund={totalRefund} shopSettings={settings} totalSteps={STEPS.length}
            onBack={() => go(prevFrom(4))} onNext={() => canContinue[4] && go(nextFrom(4))} canContinue={canContinue[4]} />
        )}
        {step === confirmStep && (
          <StepConfirm itemsList={itemsList} selectedItems={selectedItems} reasons={reasons} notes={notes}
                       totalRefund={totalRefund} email={email}
                       refundType={refundType} shopSettings={settings}
                       totalSteps={STEPS.length} isLoading={fetcher.state !== 'idle'}
                       onBack={() => go(prevFrom(confirmStep))} onSubmit={handleSubmitReturn} />
        )}
      </div>

      <div className="text-center text-[12px] text-[#888] mt-6">
        Need help? Email <a className="underline cursor-pointer" style={{ color: settings?.brandColor ?? '#6C63FF' }}>support@{shop}</a>
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-[#aaa]">
          <Icon name="Lock" size={11} /> Secured by ReturnFlow
        </div>
      </div>
    </PortalShell>
  );
}

function PortalShell({ children, settings, shop }: { children: React.ReactNode, settings: any, shop: string }) {
  return (
    <div className="min-h-screen w-full font-sans" style={{ background: '#F8FAFC', color: '#0f1117' }}>
      <header className="bg-white border-b border-[#e6e6ec]">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="h-9 w-auto object-contain" />
            ) : (
              <div className="w-9 h-9 rounded-md grid place-content-center text-white font-bold"
                   style={{ background: settings.brandColor, boxShadow: `0 4px 14px ${settings.brandColor}55` }}>
                {shop.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-[15px] font-semibold leading-tight">{shop.split('.')[0]}</div>
              <div className="text-[11.5px] text-[#888]">Return Center</div>
            </div>
          </div>
          {/* Back to store instead of admin */}
          <a href={`https://${shop}`} className="text-[12.5px] text-[#666] hover:text-[#111] flex items-center gap-1.5">
            <Icon name="ArrowLeft" size={13} /> Back to store
          </a>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">{children}</main>
    </div>
  );
}

function Stepper({ steps, current, onJump }: any) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((s: string, i: number) => {
        const idx = i + 1;
        const isDone = idx < current;
        const isCurr = idx === current;
        return (
          <React.Fragment key={s}>
            <button onClick={() => onJump(i)} className="flex items-center gap-2 group">
              <div className={`w-7 h-7 rounded-full grid place-content-center text-[12px] font-semibold transition ${
                isDone ? 'text-white' : isCurr ? 'text-white' : 'text-[#aaa]'
              }`} style={{
                background: isDone ? '#6C63FF' : isCurr ? '#0f1117' : '#fff',
                border: isDone ? 'none' : isCurr ? 'none' : '1.5px solid #d8dce5'
              }}>
                {isDone ? <Icon name="Check" size={13} strokeWidth={3} /> : idx}
              </div>
              <span className={`text-[12.5px] font-medium hidden sm:inline ${isCurr ? 'text-[#0f1117]' : isDone ? 'text-[#0f1117]' : 'text-[#aaa]'}`}>{s}</span>
            </button>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px" style={{ background: idx < current ? '#6C63FF' : '#e6e6ec' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PortalInput({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium text-[#444] mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-11 px-3.5 rounded-lg border border-[#d8dce5] bg-white text-[14px] text-[#111] placeholder:text-[#aaa] focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition" />
    </div>
  );
}

function PortalBtn({ variant = 'primary', children, full, onClick, disabled, icon, iconRight }: any) {
  const base = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg text-[13.5px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const map: Record<string, string> = {
    primary: 'text-white shadow-[0_4px_14px_rgba(108,99,255,0.3)] hover:shadow-[0_6px_20px_rgba(108,99,255,0.4)]',
    ghost: 'text-[#666] hover:text-[#111] bg-transparent hover:bg-[#f0f0f5]',
    outline: 'border border-[#d8dce5] bg-white text-[#111] hover:bg-[#f8fafc]',
  };
  const style = variant === 'primary' ? { background: '#6C63FF' } : {};
  return (
    <button onClick={onClick} disabled={disabled} style={style}
      className={`${base} ${map[variant]} ${full ? 'w-full' : ''}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

function StepFindOrder({ orderNum, setOrderNum, email, setEmail, onNext, canContinue, isLoading, error, shop, fetcher, trackingSubmitted, onTrackingReset }: any) {
  const [showTracking, setShowTracking] = useState(false);
  const [tRma, setTRma] = useState('');
  const [tEmail, setTEmail] = useState('');
  const [tCarrier, setTCarrier] = useState('');
  const [tTracking, setTTracking] = useState('');

  const trackingError = (fetcher.data as any)?.trackingError;
  const trackingLoading = fetcher.state !== 'idle' && showTracking;

  const handleTrackingSubmit = () => {
    fetcher.submit(
      { intent: 'submit_tracking', rma: tRma, email: tEmail, carrier: tCarrier, trackingNumber: tTracking },
      { method: 'POST' }
    );
  };

  if (trackingSubmitted) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-full grid place-content-center mx-auto mb-4" style={{ background: '#10B98115' }}>
          <Icon name="Truck" size={28} style={{ color: '#10B981' }} />
        </div>
        <h2 className="text-[20px] font-bold text-[#0f1117]">Tracking submitted!</h2>
        <p className="text-[13.5px] text-[#666] mt-2 max-w-xs mx-auto">Your carrier and tracking number have been saved. We'll update you when we receive your package.</p>
        <button onClick={onTrackingReset} className="mt-6 text-[13px] font-semibold" style={{ color: '#6C63FF' }}>
          Submit another return
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 1</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Find your order</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5 leading-relaxed">
        Enter your order number and the email used at checkout. We'll pull it up in a moment.
      </p>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[13px] font-medium flex items-center gap-2">
          <Icon name="TriangleAlert" size={14} /> {error}
        </div>
      )}

      <div className="mt-6 space-y-4 max-w-md">
        <PortalInput label="Order number" value={orderNum} onChange={setOrderNum} placeholder="#1089" />
        <PortalInput label="Email address" value={email} onChange={setEmail} placeholder="your@email.com" type="email" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <a href={`mailto:support@${shop}`} className="text-[12.5px] text-[#6C63FF] hover:underline cursor-pointer">Can't find your order?</a>
        <PortalBtn onClick={onNext} disabled={!canContinue || isLoading} iconRight={isLoading ? undefined : "ArrowRight"}>
          {isLoading ? 'Searching...' : 'Find Order'}
        </PortalBtn>
      </div>

      {/* Tracking submission panel */}
      <div className="mt-8 pt-6 border-t border-[#e6e6ec]">
        <button onClick={() => setShowTracking(v => !v)}
          className="w-full flex items-center justify-between text-[13px] font-medium text-[#444] hover:text-[#111] transition">
          <span className="flex items-center gap-2">
            <Icon name="Truck" size={15} />
            Already shipped your return? Submit tracking
          </span>
          <Icon name={showTracking ? "ChevronUp" : "ChevronDown"} size={14} />
        </button>

        {showTracking && (
          <div className="mt-4 p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc] space-y-3">
            {trackingError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[12.5px] flex items-center gap-2">
                <Icon name="TriangleAlert" size={13} /> {trackingError}
              </div>
            )}
            <PortalInput label="Your RMA number" value={tRma} onChange={setTRma} placeholder="RMA-2026-000001" />
            <PortalInput label="Email used at checkout" value={tEmail} onChange={setTEmail} placeholder="your@email.com" type="email" />
            <PortalInput label="Carrier" value={tCarrier} onChange={setTCarrier} placeholder="UPS, FedEx, USPS…" />
            <PortalInput label="Tracking number" value={tTracking} onChange={setTTracking} placeholder="1Z999AA1…" />
            <div className="pt-1">
              <PortalBtn onClick={handleTrackingSubmit}
                disabled={!tRma || !tEmail.includes('@') || !tCarrier || !tTracking || trackingLoading}
                icon="Truck">
                {trackingLoading ? 'Submitting...' : 'Submit Tracking'}
              </PortalBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepSelectItems({ items, orderName, date, isFulfilled, selectedItems, setSelectedItems, onBack, onNext, canContinue }: any) {
  const toggleItem = (id: string, blocked: boolean) => {
    if (blocked) return;
    setSelectedItems((s: any) => {
      const next = { ...s };
      if (next[id]?.qty > 0) delete next[id];
      else next[id] = { qty: 1 };
      return next;
    });
  };
  const setQty = (id: string, qty: number, max: number) =>
    setSelectedItems((s: any) => ({ ...s, [id]: { qty: Math.max(1, Math.min(max, qty)) } }));

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 2</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Select items to return</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">
        From order <span className="font-semibold text-[#0f1117]">{orderName}</span> · placed {new Date(date).toLocaleDateString()}.
      </p>

      {!isFulfilled && (
        <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[13px] flex items-center gap-2">
          <Icon name="TriangleAlert" size={14} />
          This order hasn't been fulfilled yet. You can submit a return request, but it will be reviewed once the order ships.
        </div>
      )}

      <div className="mt-6 space-y-2">
        {items.map((item: any) => {
          const sel = !!selectedItems[item.id];
          const qty = selectedItems[item.id]?.qty || 1;
          const blocked = !!item.blocked;
          return (
            <label key={item.id}
                   className={`flex items-center gap-4 p-4 rounded-xl border-2 transition ${
                     blocked
                       ? 'border-[#e6e6ec] opacity-50 cursor-not-allowed'
                       : sel
                       ? 'border-[#6C63FF] bg-[#6C63FF]/[0.04] cursor-pointer'
                       : 'border-[#e6e6ec] hover:border-[#cfd3df] cursor-pointer'
                   }`}>
              <input type="checkbox" checked={sel} onChange={() => toggleItem(item.id, blocked)} className="sr-only" disabled={blocked} />
              <div className={`w-5 h-5 rounded-md grid place-content-center shrink-0 transition ${
                blocked ? 'bg-[#e6e6ec]' : sel ? 'bg-[#6C63FF]' : 'bg-white border-2 border-[#d8dce5]'
              }`}>
                {blocked ? <Icon name="Ban" size={11} className="text-[#999]" /> : sel && <Icon name="Check" size={12} className="text-white" strokeWidth={3.5} />}
              </div>
              <div className="w-16 h-16 rounded-lg grid place-content-center shrink-0 border border-[#e6e6ec] bg-[#f8fafc] overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <Icon name="Shirt" size={22} className="text-[#ccc]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[#0f1117] truncate">{item.name}</div>
                <div className="text-[12.5px] text-[#666] mt-0.5">{item.variant}</div>
                {blocked && <div className="text-[11px] text-red-500 mt-0.5 font-medium">Not eligible for return</div>}
              </div>
              {sel && !blocked && (
                <div className="flex items-center gap-1 bg-white rounded-md border border-[#e6e6ec] overflow-hidden" onClick={e => e.preventDefault()}>
                  <button onClick={() => setQty(item.id, qty - 1, item.quantity)} className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]">−</button>
                  <span className="w-6 text-center text-[13px] font-semibold tabular-nums">{qty}</span>
                  <button onClick={() => setQty(item.id, qty + 1, item.quantity)} className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]">+</button>
                </div>
              )}
              <div className="text-[14px] font-semibold text-[#0f1117] tabular-nums w-16 text-right">${item.price.toFixed(2)}</div>
            </label>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepReasons({ itemsList, reasons, setReasons, notes, setNotes, exchangeNote, setExchangeNote, refundType, onBack, onNext, canContinue, totalSteps, reasonOptions }: any) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 3 of {totalSteps}</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Tell us why</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">
        Help us make it right. Pick a reason for each item.
      </p>

      <div className="mt-6 space-y-4">
        {itemsList.map((item: any) => (
          <div key={item.id} className="p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-md grid place-content-center shrink-0 border border-[#e6e6ec] bg-white overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <Icon name="Shirt" size={14} className="text-[#ccc]" />
                )}
              </div>
              <div className="flex-1 truncate">
                <div className="text-[13.5px] font-semibold text-[#0f1117] truncate">{item.name}</div>
                <div className="text-[12px] text-[#666] truncate">{item.variant}</div>
              </div>
            </div>

            <label className="block text-[12px] font-medium text-[#444] mb-1.5">Select reason</label>
            <div className="relative mb-3">
              <select value={reasons[item.id] || ''} onChange={e => setReasons((r: any) => ({ ...r, [item.id]: e.target.value }))}
                className="w-full h-11 pl-3.5 pr-9 rounded-lg border border-[#d8dce5] bg-white text-[13.5px] appearance-none focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition">
                <option value="" disabled>Choose a reason…</option>
                {reasonOptions.map((o: string) => <option key={o} value={o}>{o}</option>)}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]">
                <Icon name="ChevronDown" size={14} />
              </div>
            </div>

            <label className="block text-[12px] font-medium text-[#444] mb-1.5">Additional notes <span className="text-[#aaa] font-normal">(optional)</span></label>
            <textarea rows={2} value={notes[item.id] || ''} onChange={e => setNotes((n: any) => ({ ...n, [item.id]: e.target.value }))}
              placeholder="Anything else we should know?"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#d8dce5] bg-white text-[13px] resize-none focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition" />
          </div>
        ))}
      </div>

      {refundType === 'EXCHANGE' && (
        <div className="mt-4 p-4 rounded-xl border border-[#3B82F630] bg-[#3B82F608]">
          <label className="block text-[12.5px] font-semibold text-[#3B82F6] mb-1 flex items-center gap-1.5">
            <Icon name="RefreshCw" size={13} /> What would you like instead?
          </label>
          <p className="text-[12px] text-[#666] mb-2">Describe the item, size, or color you'd like us to send as a replacement.</p>
          <textarea rows={2} value={exchangeNote} onChange={e => setExchangeNote(e.target.value)}
            placeholder="e.g. Same shirt in Size M, Blue color"
            className="w-full px-3.5 py-2.5 rounded-lg border border-[#d8dce5] bg-white text-[13px] resize-none focus:outline-none focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/15 transition" />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepRefundType({ availableRefundTypes, refundType, setRefundType, totalRefund, shopSettings, onBack, onNext, canContinue, totalSteps }: any) {
  const showBonus = shopSettings.incentivizeStoreCredit && shopSettings.storeCreditBonusPercent > 0;
  const bonusPct  = shopSettings.storeCreditBonusPercent;
  const bonusAmount = totalRefund * (bonusPct / 100);

  const OPTIONS: Record<string, any> = {
    ORIGINAL_PAYMENT: {
      icon: 'CreditCard',
      title: 'Refund to original payment',
      desc:  'Refunded to your original payment method within 5–10 business days.',
      badge: null,
      foot:  null,
    },
    STORE_CREDIT: {
      icon: 'Gift',
      title: 'Store credit',
      desc:  'Get store credit to use on your next purchase. Available instantly.',
      badge: { label: '⚡ Instant', kind: 'accent' },
      bonusBadge: showBonus ? { label: `+${bonusPct}% bonus credit`, amount: `Get $${(totalRefund + bonusAmount).toFixed(2)} instead of $${totalRefund.toFixed(2)}` } : null,
    },
    EXCHANGE: {
      icon: 'RefreshCw',
      title: 'Exchange for another item',
      desc:  "We'll send you a replacement once we receive your return.",
      badge: { label: '🔄 Recommended', kind: 'info' },
      foot:  "You'll select your replacement item after submitting.",
    },
  };

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 4 of {totalSteps}</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">How would you like to be refunded?</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">Choose the option that works best for you.</p>

      <div className="mt-6 space-y-3" role="radiogroup" aria-label="Refund method">
        {availableRefundTypes.map((key: string) => {
          const opt = OPTIONS[key];
          const selected = refundType === key;
          return (
            <button key={key}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => setRefundType(key)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 relative group cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6C63FF]/20 ${
                      selected
                        ? 'border-[#6C63FF] bg-[#6C63FF]/[0.04]'
                        : 'border-[#e6e6ec] bg-white hover:border-[#cfd3df]'
                    }`}>
              {selected && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full grid place-content-center shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                     style={{ background: '#6C63FF' }}>
                  <Icon name="Check" size={13} strokeWidth={3.5} className="text-white" />
                </div>
              )}

              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-lg grid place-content-center shrink-0 transition-colors ${
                  selected ? 'text-white' : 'text-[#444]'
                }`} style={{ background: selected ? '#6C63FF' : '#f0f0f5' }}>
                  <Icon name={opt.icon} size={18} />
                </div>

                <div className="flex-1 min-w-0 pr-8">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14.5px] font-bold text-[#0f1117]">{opt.title}</span>
                    {opt.badge && (
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full tracking-wide"
                            style={opt.badge.kind === 'accent'
                              ? { background: '#6C63FF', color: 'white' }
                              : { background: '#3B82F615', color: '#3B82F6' }}>
                        {opt.badge.label}
                      </span>
                    )}
                    {key === 'STORE_CREDIT' && opt.bonusBadge && (
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: 'linear-gradient(90deg,#F59E0B,#EF4444)', color: 'white' }}>
                        {opt.bonusBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-[#666] mt-1 leading-relaxed">{opt.desc}</div>
                  {key === 'STORE_CREDIT' && opt.bonusBadge && (
                     <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold"
                          style={{ background: 'rgba(108,99,255,0.10)', color: '#6C63FF' }}>
                       <Icon name="Sparkles" size={11} /> {opt.bonusBadge.amount}
                     </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepConfirm({ itemsList, selectedItems, reasons, notes, totalRefund, onBack, onSubmit, refundType, shopSettings, totalSteps, isLoading }: any) {
  const meta = REFUND_TYPES[refundType] || REFUND_TYPES['ORIGINAL_PAYMENT'];
  const showBonus = refundType === 'STORE_CREDIT' && shopSettings.incentivizeStoreCredit && shopSettings.storeCreditBonusPercent > 0;
  const bonusAmount = showBonus ? totalRefund * (shopSettings.storeCreditBonusPercent / 100) : 0;
  const creditTotal = totalRefund + bonusAmount;

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step {totalSteps} of {totalSteps}</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Review & submit</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">One last look before we send this.</p>

      <div className="mt-6 space-y-3">
        {itemsList.map((item: any) => (
          <div key={item.id} className="flex gap-4 p-4 rounded-xl border border-[#e6e6ec] bg-white">
            <div className="w-14 h-14 rounded-md grid place-content-center shrink-0 border border-[#e6e6ec] bg-[#f8fafc] overflow-hidden">
              {item.image ? (
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <Icon name="Shirt" size={18} className="text-[#ccc]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-3">
                <div className="text-[13.5px] font-semibold text-[#0f1117] truncate">{item.name}</div>
                <div className="text-[13.5px] font-semibold tabular-nums">${(item.price * selectedItems[item.id].qty).toFixed(2)}</div>
              </div>
              <div className="text-[12px] text-[#666] mt-0.5 truncate">{item.variant} · Qty {selectedItems[item.id].qty}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
                <span className="px-2 py-0.5 rounded bg-[#f0f0f5] text-[#444]">{reasons[item.id]}</span>
                {notes[item.id] && <span className="px-2 py-0.5 rounded bg-[#fff7e6] text-[#a07300] italic truncate max-w-xs">"{notes[item.id]}"</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 p-4 rounded-xl bg-[#fafbfc] border border-[#e6e6ec]">
        <div className="flex justify-between text-[13px] text-[#666]"><span>Subtotal</span><span className="tabular-nums">${totalRefund.toFixed(2)}</span></div>
        <div className="flex justify-between text-[13px] text-[#666] mt-1"><span>Restocking fee</span><span className="tabular-nums">−$0.00</span></div>
        {showBonus && (
          <div className="flex justify-between text-[13px] mt-1" style={{ color: '#6C63FF' }}>
            <span className="flex items-center gap-1"><Icon name="Sparkles" size={11} /> Store credit bonus (+{shopSettings.storeCreditBonusPercent}%)</span>
            <span className="tabular-nums">+${bonusAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-[#e6e6ec] my-2.5"></div>
        <div className="flex justify-between text-[15px] font-bold text-[#0f1117]">
          <span>{refundType === 'EXCHANGE' ? 'Estimated value' : showBonus ? 'Total store credit' : 'Estimated refund'}</span>
          <span className="tabular-nums">${(showBonus ? creditTotal : totalRefund).toFixed(2)}</span>
        </div>

        <div className="mt-3 pt-3 border-t border-[#e6e6ec] flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#666] font-medium">Refund method</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold"
                style={{ background: meta.bg, color: meta.color }}>
            <Icon name={meta.icon} size={12} />
            {refundType === 'ORIGINAL_PAYMENT' && 'Refund to original payment (5–10 days)'}
            {refundType === 'STORE_CREDIT'     && `Store credit · $${(showBonus ? creditTotal : totalRefund).toFixed(2)}`}
            {refundType === 'EXCHANGE'         && 'Exchange · item selection after submission'}
          </span>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onSubmit} full={false} icon={isLoading ? undefined : "CircleCheck"} disabled={isLoading}>
          {isLoading ? 'Submitting...' : 'Submit Return Request'}
        </PortalBtn>
      </div>
    </div>
  );
}

function PortalConfirmation({ rma, email, refundType, onReset }: any) {
  const isExchange = refundType === 'EXCHANGE';
  const isStoreCredit = refundType === 'STORE_CREDIT';

  const steps = isExchange
    ? [
        'Your exchange request is being reviewed by our team.',
        `Once approved, you'll receive a prepaid shipping label at ${email}.`,
        "Ship the item back and we'll send your replacement once received.",
      ]
    : isStoreCredit
    ? [
        'Your request will be reviewed by our team.',
        `Once approved, you'll receive a prepaid shipping label at ${email}.`,
        'Your store credit code will be emailed as soon as we receive your item.',
      ]
    : [
        'Your request will be reviewed by our team.',
        `Once approved, you'll receive a prepaid shipping label at ${email}.`,
        'Once received, your refund is issued within 3–5 business days.',
      ];

  return (
    <div className="text-center max-w-md mx-auto py-6">
      <div className="w-16 h-16 rounded-full grid place-content-center mx-auto mb-4 relative"
           style={{ background: isExchange ? '#3B82F615' : '#22C55E15' }}>
        <div className="absolute inset-0 rounded-full animate-ping"
             style={{ background: isExchange ? '#3B82F622' : '#22C55E22' }} />
        <Icon name={isExchange ? 'RefreshCw' : 'Check'} size={28} strokeWidth={3}
              style={{ color: isExchange ? '#3B82F6' : '#22C55E' }} />
      </div>
      <h2 className="text-[24px] font-bold text-[#0f1117] tracking-tight">
        {isExchange ? 'Exchange request submitted!' : 'Your return is submitted'}
      </h2>
      <p className="text-[13.5px] text-[#666] mt-2 leading-relaxed">
        {isExchange
          ? "We've received your exchange request. Our team will review it and get back to you shortly."
          : "We've sent the details to the store. You'll get an email shortly with next steps."}
      </p>

      <div className="mt-6 p-5 rounded-xl bg-white border border-[#e6e6ec] text-left">
        <div className="text-[11.5px] uppercase tracking-wider text-[#888] font-semibold">Your RMA</div>
        <div className="text-[20px] font-bold text-[#0f1117] font-mono mt-1">{rma}</div>
        <div className="mt-3 pt-3 border-t border-[#e6e6ec] space-y-2 text-[12.5px]">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-6 h-6 rounded-full grid place-content-center shrink-0 text-white text-[10px] font-bold"
                   style={{ background: '#6C63FF' }}>{i + 1}</div>
              <div className="text-[#444]">{step}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onReset} className="mt-6 text-[13px] font-semibold" style={{ color: '#6C63FF' }}>
        Start another return
      </button>
    </div>
  );
}
