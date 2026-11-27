// SMYL · Piezas de Deno para las suscripciones con Openpay: llamada a la API y acceso a la base (rol de servicio).
// La lógica de cobro vive en openpay-billing-core.mjs (pura, con pruebas); aquí solo se conecta a Openpay y a Supabase.
//
// Secrets de la función (Project Settings → Edge Functions → Secrets):
//   OPENPAY_MERCHANT_ID, OPENPAY_PRIVATE_KEY (sk_…, SOLO servidor), OPENPAY_PUBLIC_KEY (pk_…, se entrega al navegador),
//   OPENPAY_ENV = sandbox | production, y para el aviso de pagos OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD.
import { createClient } from "npm:@supabase/supabase-js@2";
import { openpayBase } from "./openpay-plans.mjs";
import { createBilling } from "./openpay-billing-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

export const OPENPAY_ENV = Deno.env.get("OPENPAY_ENV") === "production" ? "production" : "sandbox";
const MERCHANT = Deno.env.get("OPENPAY_MERCHANT_ID") || "";
const PRIVATE_KEY = Deno.env.get("OPENPAY_PRIVATE_KEY") || "";
export const OPENPAY_PUBLIC_KEY = Deno.env.get("OPENPAY_PUBLIC_KEY") || "";
export const OPENPAY_MERCHANT_ID = MERCHANT;

export function openpayConfigured(): boolean {
  return Boolean(MERCHANT && PRIVATE_KEY && OPENPAY_PUBLIC_KEY);
}

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

async function op(method: string, path: string, body?: unknown): Promise<{ status: number; data: Json }> {
  const response = await fetch(`${openpayBase(OPENPAY_ENV)}/${MERCHANT}${path}`, {
    method,
    headers: { Authorization: "Basic " + btoa(PRIVATE_KEY + ":"), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let data: Json = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  return { status: response.status, data };
}

const store = {
  async planId(planKey: string, periodo: string): Promise<string | null> {
    const { data } = await admin.from("smyl_billing_plans").select("openpay_plan_id")
      .eq("plan_key", planKey).eq("periodo", periodo).eq("environment", OPENPAY_ENV).maybeSingle();
    return data?.openpay_plan_id || null;
  },
  async planFilas(): Promise<Json[]> {
    const { data } = await admin.from("smyl_billing_plans").select("plan_key,periodo,openpay_plan_id").eq("environment", OPENPAY_ENV);
    return data || [];
  },
  async customer(tenantId: string): Promise<Json | null> {
    const { data } = await admin.from("smyl_billing_customers").select("openpay_customer_id,card_id,card_brand,card_last4")
      .eq("tenant_id", tenantId).eq("environment", OPENPAY_ENV).maybeSingle();
    return data || null;
  },
  async saveCustomer(tenantId: string, row: Json): Promise<void> {
    const { error } = await admin.from("smyl_billing_customers").upsert(
      { tenant_id: tenantId, environment: OPENPAY_ENV, ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,environment" });
    if (error) throw new Error("No se pudo guardar tu cuenta de pago.");
  },
  async subscription(tenantId: string): Promise<Json | null> {
    const { data } = await admin.from("smyl_billing_subscriptions")
      .select("openpay_subscription_id,plan_key,periodo,status,cancel_at_period_end,next_charge_date,period_end_date")
      .eq("tenant_id", tenantId).eq("environment", OPENPAY_ENV).maybeSingle();
    return data || null;
  },
  async saveSubscription(tenantId: string, row: Json): Promise<void> {
    const { error } = await admin.from("smyl_billing_subscriptions").upsert(
      { tenant_id: tenantId, environment: OPENPAY_ENV, ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,environment" });
    if (error) throw new Error("No se pudo guardar tu suscripción.");
  },
  async tenantByCustomer(openpayCustomerId: string): Promise<string | null> {
    const { data } = await admin.from("smyl_billing_customers").select("tenant_id")
      .eq("environment", OPENPAY_ENV).eq("openpay_customer_id", openpayCustomerId).maybeSingle();
    return data?.tenant_id || null;
  },
  async recordEvent(key: string, type: string, tenantId: string | null): Promise<boolean> {
    const { error } = await admin.from("smyl_billing_events").insert({ event_key: key, environment: OPENPAY_ENV, event_type: type, tenant_id: tenantId });
    if (!error) return true;
    if ((error as Json).code === "23505") return false; // ya procesado
    throw new Error("No se pudo registrar el aviso de pago.");
  },
  async applyToTenant(tenantId: string, patch: Json): Promise<void> {
    const { error } = await admin.from("camila_tenants").update(patch).eq("id", tenantId);
    if (error) throw new Error("No se pudo actualizar tu plan.");
  },
};

export const billing = createBilling({ op, store, now: () => new Date() });
export { admin as billingAdmin, store as billingStore };
