import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PageHeader, Btn, Icon, Toggle, Input, Textarea, Select, useToast } from "../components/ui";
import { DEFAULT_REASONS, EMAIL_TEMPLATES } from "../components/mock-data";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({
    where: { shop },
    include: { reasons: true },
  });

  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: {
        shop,
        reasons: {
          create: DEFAULT_REASONS.map(r => ({ label: r.label, enabled: r.enabled }))
        }
      },
      include: { reasons: true }
    });
  }

  const emailTemplates = await prisma.emailTemplate.findMany({ where: { shop } });

  // Seed default templates if not present
  const TEMPLATE_TYPES = ['Request Received', 'Approved', 'Rejected', 'Refunded'];
  for (const type of TEMPLATE_TYPES) {
    const exists = emailTemplates.find(t => t.type === type);
    if (!exists) {
      const def = EMAIL_TEMPLATES[type as keyof typeof EMAIL_TEMPLATES];
      await prisma.emailTemplate.create({ data: { shop, type, subject: def.subject, body: def.body } });
    }
  }
  const templates = await prisma.emailTemplate.findMany({ where: { shop } });

  return { settings, templates };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_general") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { 
        returnWindow: Number(formData.get("returnWindow")), 
        returnAddress: formData.get("returnAddress") as string, 
        autoApprove: formData.get("autoApprove") === "true", 
        notifyMerchant: formData.get("notifyMerchant") === "true", 
        fromEmail: formData.get("fromEmail") as string, 
        allowStoreCredit: formData.get("allowStoreCredit") === "true", 
        allowExchanges: formData.get("allowExchanges") === "true", 
        storeCreditBonusPercent: Number(formData.get("storeCreditBonusPercent")), 
        incentivizeStoreCredit: formData.get("incentivizeStoreCredit") === "true" 
      }
    });
  } else if (intent === "save_reasons") {
    const reasonsStr = formData.get("reasons") as string;
    const reasons = JSON.parse(reasonsStr);
    
    await prisma.$transaction([
      prisma.returnReason.deleteMany({ where: { shop } }),
      prisma.returnReason.createMany({
        data: reasons.map((r: any) => ({ shop, label: r.label, enabled: r.enabled }))
      })
    ]);
  } else if (intent === "save_branding") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { 
        brandColor: formData.get("brandColor") as string,
        logoUrl: formData.get("logoUrl") as string | null
      }
    });
  } else if (intent === "save_policy") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { returnPolicy: formData.get("returnPolicy") as string }
    });
  } else if (intent === "save_email_template") {
    const type = formData.get("templateType") as string;
    const subject = formData.get("subject") as string;
    const body = formData.get("body") as string;
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      create: { shop, type, subject, body },
      update: { subject, body }
    });
  }

  return { success: true };
};

export default function SettingsPage() {
  const { settings, templates } = useLoaderData<typeof loader>();
  const [tab, setTab] = useState('General');
  
  const tabs = [
    { key: 'General',  icon: 'Settings2' },
    { key: 'Reasons',  icon: 'Tag' },
    { key: 'Emails',   icon: 'Mail' },
    { key: 'Branding', icon: 'Palette' },
    { key: 'Policy',   icon: 'FileText' },
  ];

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure how returns work for your store." />

      {/* Secondary tab nav */}
      <div className="flex items-center gap-1 border-b border-divider mb-6 overflow-x-auto">
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              <Icon name={t.icon} size={13.5} />
              {t.key}
              {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {tab === 'General'  && <GeneralTab settings={settings} />}
      {tab === 'Reasons'  && <ReasonsTab settings={settings} />}
      {tab === 'Emails'   && <EmailsTab templates={templates} />}
      {tab === 'Branding' && <BrandingTab settings={settings} />}
      {tab === 'Policy'   && <PolicyTab settings={settings} />}
    </div>
  );
}

function SettingRow({ label, hint, children, wide }: any) {
  return (
    <div className={`py-5 border-b border-divider last:border-0 grid ${wide ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[260px_1fr]'} gap-3 md:gap-8`}>
      <div className="pt-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-1 leading-relaxed max-w-[260px]">{hint}</div>}
      </div>
      <div className="max-w-xl">{children}</div>
    </div>
  );
}

function SaveBar({ onSave, onDiscard, isSaving }: any) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      <Btn variant="ghost" onClick={onDiscard} disabled={isSaving}>Discard</Btn>
      <Btn variant="primary" icon="Check" onClick={onSave} disabled={isSaving}>
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Btn>
    </div>
  );
}

// ---- General tab ----
function GeneralTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_general";
  const actionData = useActionData<typeof action>();

  const [returnWindow, setReturnWindow] = useState(settings.returnWindow);
  const [address, setAddress] = useState(settings.returnAddress);
  const [autoApprove, setAutoApprove] = useState(settings.autoApprove);
  const [notify, setNotify] = useState(settings.notifyMerchant);
  const [fromEmail, setFromEmail] = useState(settings.fromEmail);
  const [allowStoreCredit, setAllowStoreCredit] = useState(settings.allowStoreCredit);
  const [allowExchanges, setAllowExchanges] = useState(settings.allowExchanges);
  const [storeCreditBonusPercent, setStoreCreditBonusPercent] = useState(settings.storeCreditBonusPercent);
  const [incentivizeStoreCredit, setIncentivizeStoreCredit] = useState(settings.incentivizeStoreCredit);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_general") {
      toast({ kind: 'success', title: 'General settings saved' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_general");
    formData.append("returnWindow", returnWindow.toString());
    formData.append("returnAddress", address);
    formData.append("autoApprove", autoApprove.toString());
    formData.append("notifyMerchant", notify.toString());
    formData.append("fromEmail", fromEmail);
    formData.append("allowStoreCredit", allowStoreCredit.toString());
    formData.append("allowExchanges", allowExchanges.toString());
    formData.append("storeCreditBonusPercent", storeCreditBonusPercent.toString());
    formData.append("incentivizeStoreCredit", incentivizeStoreCredit.toString());
    
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg px-6">
      <SettingRow label="Return window" hint="How many days after delivery customers can request a return.">
        <div className="flex items-center gap-2">
          <input type="number" value={returnWindow} onChange={e => setReturnWindow(+e.target.value)}
            className="w-24 h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
          <span className="text-[13px] text-muted">days</span>
        </div>
      </SettingRow>

      <SettingRow label="Return address" hint="Shown on the customer-facing return label and confirmation emails.">
        <Textarea value={address} onChange={(e: any) => setAddress(e.target.value)} rows={4} />
      </SettingRow>

      <SettingRow label="Auto-approve returns" hint="Skip manual review for returns under your return window.">
        <Toggle checked={autoApprove} onChange={setAutoApprove}
                label={autoApprove ? 'Returns are auto-approved' : 'Manual review required'}
                description="Recommended off until your reason policy is tuned." />
      </SettingRow>

      <SettingRow label="Notify merchant" hint="Get an email each time a customer files a new return.">
        <Toggle checked={notify} onChange={setNotify}
                label="Email me when a new request comes in"
                description={fromEmail} />
      </SettingRow>

      <SettingRow label="From email" hint="The reply-to address on automated emails to customers.">
        <Input value={fromEmail} onChange={(e: any) => setFromEmail(e.target.value)} type="email" />
      </SettingRow>

      {/* Revenue Retention section */}
      <div className="py-6 border-b border-divider last:border-0">
        <div className="mb-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(108,99,255,0.15)', color: '#8B85FF' }}>
            <Icon name="TrendingUp" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Revenue Retention</div>
            <div className="text-[12.5px] text-muted mt-0.5 max-w-md leading-relaxed">
              Encourage customers to keep revenue in your store instead of requesting refunds.
            </div>
          </div>
        </div>

        <div className="space-y-4 ml-0 md:ml-12">
          {/* Store credit */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={allowStoreCredit} onChange={setAllowStoreCredit}
                    label="Allow Store Credit refunds"
                    description="Let customers choose store credit — issued instantly, retains revenue." />
            {allowStoreCredit && (
              <div className="mt-3 pl-12 space-y-3 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Store credit bonus</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={0} max={50}
                           value={storeCreditBonusPercent}
                           onChange={e => setStoreCreditBonusPercent(Math.max(0, Math.min(50, +e.target.value || 0)))}
                           placeholder="10"
                           className="w-20 h-8 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
                    <span className="text-[12.5px] text-muted">% bonus</span>
                  </div>
                  <span className="text-[11.5px] text-faint">0 = no bonus</span>
                </div>
                <Toggle checked={incentivizeStoreCredit}
                        onChange={setIncentivizeStoreCredit}
                        label="Incentivize store credit in the portal"
                        description="Show a badge and the bonus percentage on the store-credit option." />
                {incentivizeStoreCredit && storeCreditBonusPercent > 0 && (
                  <div className="px-3 py-2 rounded-md text-[12px] flex items-center gap-2 animate-fadeIn"
                       style={{ background: 'rgba(108,99,255,0.10)', color: '#8B85FF' }}>
                    <Icon name="Sparkles" size={12} />
                    Customers will see <strong className="text-ink">+{storeCreditBonusPercent}% bonus credit</strong> on the store-credit option.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exchanges */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={allowExchanges} onChange={setAllowExchanges}
                    label="Allow Exchanges"
                    description="Let customers swap an item for another size, color, or product." />
            {allowExchanges && (
              <div className="mt-3 pl-12 space-y-2 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Exchange window</label>
                  <span className="text-[12.5px] text-ink">Same as return window ({returnWindow} days)</span>
                </div>
                <div className="text-[11.5px] text-muted leading-relaxed">
                  Customers will be able to select <span className="text-ink">Exchange</span> as their refund type in the portal.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pb-6"><SaveBar onSave={handleSave} onDiscard={() => {
        setReturnWindow(settings.returnWindow);
        setAddress(settings.returnAddress);
        setAutoApprove(settings.autoApprove);
        setNotify(settings.notifyMerchant);
        setFromEmail(settings.fromEmail);
        setAllowStoreCredit(settings.allowStoreCredit);
        setAllowExchanges(settings.allowExchanges);
        setStoreCreditBonusPercent(settings.storeCreditBonusPercent);
        setIncentivizeStoreCredit(settings.incentivizeStoreCredit);
      }} isSaving={isSaving} /></div>
    </div>
  );
}

// ---- Reasons tab ----
function ReasonsTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_reasons";
  const actionData = useActionData<typeof action>();

  const [reasons, setReasons] = useState(settings.reasons.map((r: any, idx: number) => ({ id: idx, label: r.label, enabled: r.enabled })));
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_reasons") {
      toast({ kind: 'success', title: 'Reasons updated' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const addReason = () => {
    if (!newLabel.trim()) return;
    setReasons((r: any) => [...r, { id: Date.now(), label: newLabel.trim(), enabled: true }]);
    setNewLabel('');
    toast({ kind: 'success', title: 'Reason added' });
  };
  const toggle = (id: number) => setReasons((rs: any) => rs.map((r: any) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  const del = (id: number) => { setReasons((rs: any) => rs.filter((r: any) => r.id !== id)); toast({ kind: 'info', title: 'Reason removed' }); };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_reasons");
    formData.append("reasons", JSON.stringify(reasons.map((r: any) => ({ label: r.label, enabled: r.enabled }))));
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return reasons</div>
          <div className="text-[12.5px] text-muted mt-1">Customers pick one of these when filing a return.</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {reasons.map((r: any) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md bg-bg/30 border border-divider group">
            <Icon name="GripVertical" size={14} className="text-faint cursor-grab" />
            <div className={`flex-1 text-[13.5px] ${r.enabled ? 'text-ink' : 'text-faint line-through'}`}>{r.label}</div>
            <Toggle checked={r.enabled} onChange={() => toggle(r.id)} />
            <button onClick={() => del(r.id)} className="p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover:opacity-100">
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-divider flex items-center gap-2">
        <Input value={newLabel} onChange={(e: any) => setNewLabel(e.target.value)}
               onKeyDown={(e: any) => e.key === 'Enter' && addReason()}
               placeholder="e.g. Item not as pictured" className="flex-1" />
        <Btn variant="secondary" icon="Plus" onClick={addReason} disabled={!newLabel.trim()}>Add Custom Reason</Btn>
      </div>

      <div className="pt-6 border-t border-divider mt-6"><SaveBar onSave={handleSave} onDiscard={() => setReasons(settings.reasons.map((r: any, idx: number) => ({ id: idx, label: r.label, enabled: r.enabled })))} isSaving={isSaving} /></div>
    </div>
  );
}

// ---- Emails tab ----
function EmailsTab({ templates }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const actionData = useActionData<typeof action>();

  const [templateType, setTemplateType] = useState('Request Received');
  
  const currentTemplate = templates.find((t: any) => t.type === templateType) || 
    templates[0] || { subject: '', body: '' };
  
  const [subject, setSubject] = useState(currentTemplate.subject);
  const [body, setBody] = useState(currentTemplate.body);
  
  const isSaving = navigation.state === "submitting" && 
    (navigation.formData as FormData | undefined)?.get("intent") === "save_email_template";

  useEffect(() => {
    const t = templates.find((t: any) => t.type === templateType);
    if (t) { setSubject(t.subject); setBody(t.body); }
  }, [templateType, templates]);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && 
        (navigation.formData as FormData | undefined)?.get("intent") === "save_email_template") {
      toast({ kind: 'success', title: 'Email template saved' });
    }
  }, [actionData, navigation.state, navigation.formData, toast]);

  const handleSave = () => {
    const fd = new FormData();
    fd.append("intent", "save_email_template");
    fd.append("templateType", templateType);
    fd.append("subject", subject);
    fd.append("body", body);
    submit(fd, { method: "POST" });
  };

  const fill = (s: string) => s
    .replace(/\{\{customer_name\}\}/g,  'Sarah')
    .replace(/\{\{rma_number\}\}/g,     'RMA-2026-000012')
    .replace(/\{\{order_number\}\}/g,   '#1089')
    .replace(/\{\{item_count\}\}/g,     '2')
    .replace(/\{\{refund_amount\}\}/g,  '$83.00')
    .replace(/\{\{rejection_reason\}\}/g, 'Outside 30-day return window');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-6">
        <label className="text-[12px] font-medium text-muted block mb-1.5">Template</label>
        <Select value={templateType} onChange={setTemplateType}
          options={['Request Received', 'Approved', 'Rejected', 'Refunded']} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Subject line</label>
        <Input value={subject} onChange={(e: any) => setSubject(e.target.value)} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Body</label>
        <Textarea value={body} onChange={(e: any) => setBody(e.target.value)} rows={11} className="font-mono text-[12.5px]" />

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-faint mr-1">Variables:</span>
          {['{{customer_name}}','{{rma_number}}','{{order_number}}','{{refund_amount}}'].map(v => (
            <span key={v} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent2 font-mono">{v}</span>
          ))}
        </div>

        <SaveBar onSave={handleSave} onDiscard={() => {
          const t = templates.find((t: any) => t.type === templateType);
          if (t) { setSubject(t.subject); setBody(t.body); }
        }} isSaving={isSaving} />
      </div>

      <div className="lg:col-span-2">
        <div className="text-[12px] font-medium text-muted mb-2 flex items-center gap-1.5"><Icon name="Eye" size={12}/> Live preview</div>
        <div className="bg-[#f6f6f8] rounded-lg border border-border shadow-pop overflow-hidden">
          <div className="bg-white px-5 py-3 border-b border-[#e6e6ec] flex items-center gap-2">
            <div className="w-7 h-7 rounded grid place-content-center text-white text-[11px] font-bold"
                 style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>A</div>
            <div>
              <div className="text-[12.5px] font-semibold text-[#111]">Acme Store</div>
              <div className="text-[10.5px] text-[#666]">to sarah.johnson@email.com</div>
            </div>
          </div>
          <div className="px-5 py-4 bg-white">
            <div className="text-[14px] font-semibold text-[#111] mb-3">{fill(subject)}</div>
            <pre className="text-[12.5px] text-[#333] whitespace-pre-wrap font-sans leading-relaxed">{fill(body)}</pre>
            <div className="mt-4 pt-4 border-t border-[#e6e6ec]">
              <button className="w-full h-9 rounded text-[12.5px] font-semibold text-white"
                      style={{ background: '#6C63FF' }}>View return status</button>
            </div>
          </div>
          <div className="bg-[#f1f1f5] px-5 py-2.5 text-[10.5px] text-[#888] text-center">Sent by ReturnFlow · Acme Store</div>
        </div>
      </div>
    </div>
  );
}

// ---- Branding tab ----
function BrandingTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_branding";
  const actionData = useActionData<typeof action>();

  const [color, setColor] = useState(settings.brandColor);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || '');

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_branding") {
      toast({ kind: 'success', title: 'Branding updated' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_branding");
    formData.append("brandColor", color);
    formData.append("logoUrl", logoUrl);
    submit(formData, { method: "POST" });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-6">
        <SettingRow label="Store logo URL" hint="Paste a public URL to your logo (PNG, SVG). Shown on the customer return portal and emails.">
          <div className="flex items-center gap-2">
            <Input
              value={logoUrl}
              onChange={(e: any) => setLogoUrl(e.target.value)}
              placeholder="https://cdn.myshop.com/logo.png"
              className="flex-1"
            />
            {logoUrl && (
              <button onClick={() => setLogoUrl('')} className="text-faint hover:text-danger transition p-1">
                <Icon name="X" size={14} />
              </button>
            )}
          </div>
          {logoUrl && (
            <div className="mt-2 flex items-center gap-2">
              <img src={logoUrl} alt="Logo preview" className="h-10 w-auto object-contain rounded border border-border bg-white p-1"
                   onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="text-[11.5px] text-muted">Preview</span>
            </div>
          )}
        </SettingRow>

        <SettingRow label="Brand color" hint="Used for buttons and accents on the customer portal.">
          <div className="flex items-center gap-3">
            <label className="relative w-10 h-10 rounded-md border border-border cursor-pointer overflow-hidden" style={{ background: color }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            <Input value={color} onChange={(e: any) => setColor(e.target.value)} className="w-32 font-mono" />
            <div className="flex gap-1.5">
              {['#6C63FF','#3B82F6','#22C55E','#EF4444','#F59E0B','#0F1117'].map(c => (
                <button key={c} onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-md border-2 transition ${color.toLowerCase() === c.toLowerCase() ? 'border-ink' : 'border-border hover:border-muted'}`}
                        style={{ background: c }} />
              ))}
            </div>
          </div>
        </SettingRow>

        <div className="pt-2">
          <a href="/portal" target="_blank" rel="noreferrer">
            <Btn variant="secondary" icon="ExternalLink">Preview Portal</Btn>
          </a>
        </div>

        <SaveBar onSave={handleSave} onDiscard={() => { setColor(settings.brandColor); setLogoUrl(settings.logoUrl || ''); }} isSaving={isSaving} />
      </div>

      <div className="lg:col-span-2">
        <div className="text-[12px] font-medium text-muted mb-2 flex items-center gap-1.5"><Icon name="Eye" size={12}/> Customer portal preview</div>
        <div className="rounded-lg overflow-hidden border border-border shadow-pop">
          <div className="bg-[#1a1d27] px-3 py-2 flex items-center gap-1.5 border-b border-border">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>
            <div className="flex-1 mx-3 h-5 rounded text-[10px] bg-bg text-faint flex items-center px-2">acmestore.com/returns</div>
          </div>
          <div className="bg-[#F8FAFC] text-[#111] px-5 py-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded grid place-content-center text-white text-[11px] font-bold" style={{ background: color }}>A</div>
              <div className="text-[13px] font-semibold">Acme Store · Return Center</div>
            </div>
            <div className="text-[11px] uppercase tracking-wider text-[#888] mb-1.5">Step 1 of 4</div>
            <div className="text-[16px] font-semibold mb-3">Find your order</div>
            <div className="space-y-2 mb-4">
              <div className="h-9 rounded border border-[#d8dce5] bg-white px-3 text-[12px] text-[#aaa] flex items-center">#1089</div>
              <div className="h-9 rounded border border-[#d8dce5] bg-white px-3 text-[12px] text-[#aaa] flex items-center">your@email.com</div>
            </div>
            <button className="w-full h-10 rounded text-[13px] font-semibold text-white transition" style={{ background: color }}>
              Find Order
            </button>
            <div className="mt-4 text-[10.5px] text-[#888] text-center">Powered by ReturnFlow</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Policy tab ----
function PolicyTab({ settings }: any) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const toast = useToast();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") === "save_policy";
  const actionData = useActionData<typeof action>();

  const [policy, setPolicy] = useState(settings.returnPolicy);

  useEffect(() => {
    if (actionData?.success && navigation.state === "idle" && navigation.formData?.get("intent") === "save_policy") {
      toast({ kind: 'success', title: 'Policy updated' });
    }
  }, [actionData, navigation.state, navigation.formData]);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("intent", "save_policy");
    formData.append("returnPolicy", policy);
    submit(formData, { method: "POST" });
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return policy</div>
          <div className="text-[12.5px] text-muted mt-1">Shown on the customer portal and linked in confirmation emails.</div>
        </div>
        <div className="text-[11.5px] text-muted flex items-center gap-1.5">
          <Icon name="Eye" size={12} /> {policy.length} characters · {policy.split(/\s+/).filter(Boolean).length} words
        </div>
      </div>
      <Textarea value={policy} onChange={(e: any) => setPolicy(e.target.value)} rows={14} className="leading-relaxed" />
      <SaveBar onSave={handleSave} onDiscard={() => setPolicy(settings.returnPolicy)} isSaving={isSaving} />
    </div>
  );
}
