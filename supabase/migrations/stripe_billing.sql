-- Ejecutar en el SQL Editor de Supabase antes de desplegar las Edge
-- Functions de Stripe (stripe-checkout, stripe-portal, stripe-webhook).
alter table camila_tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;
