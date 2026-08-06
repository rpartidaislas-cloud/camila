# Frontend pieces

## Embedded Signup — let a tenant connect their own number/page

```html
<script src="https://connect.facebook.net/es_LA/sdk.js"></script>
<script>
FB.init({ appId: "YOUR_APP_ID", version: "v21.0" });

function conectarWhatsApp() {
  FB.login(function(response) {
    if (response.authResponse?.code) {
      // Send this "code" to your backend -- exchange it there for the real
      // account IDs (phone_number_id, waba_id) using the System User token,
      // and store them in meta_conexiones for THIS tenant.
      fetch("/api/meta-conectar", {
        method: "POST",
        body: JSON.stringify({ code: response.authResponse.code, tenant_id: MY_TENANT_ID }),
      });
    }
  }, {
    config_id: "YOUR_EMBEDDED_SIGNUP_CONFIG_ID", // created in Meta for Developers
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {} },
  });
}
</script>
<button onclick="conectarWhatsApp()">Connect WhatsApp</button>
```

For Messenger/Instagram, same pattern but with `scope: "pages_messaging"` /
`"instagram_manage_messages"` instead of a WhatsApp `config_id`.

### The `/api/meta-conectar` endpoint (server-side, another Edge Function)

Must run server-side — it needs the App Secret, which can never reach the
browser. It:

1. Exchanges the `code` for a short-lived access token belonging to the
   client's Meta account.
2. Uses that token to read the real `phone_number_id`/`waba_id` (or
   `page_id`/`instagram_id`) of the account the client just connected.
3. Inserts a row into `meta_conexiones` for that tenant.

## Inbox: live updates with Supabase Realtime

```js
const canal = supabase.channel('inbox-' + tenantId)
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'conversaciones',
    filter: 'tenant_id=eq.' + tenantId,
  }, (payload) => {
    // Update your in-memory conversation list from payload.new.
    // payload.old is also complete here because of `replica identity full`
    // in schema.sql -- use it to detect "did necesita_asesor just flip to
    // true" vs "this row changed for some other reason".
  })
  .subscribe();

// on unmount: supabase.removeChannel(canal)
```

## Pausing the AI for a conversation (human takes over)

```js
await supabase.from('conversaciones').update({ pausado: true }).eq('id', conversacionId);
// ...and to hand back to the AI:
await supabase.from('conversaciones').update({ pausado: false }).eq('id', conversacionId);
```

## Security notes

- `META_TOKEN` and `META_APP_SECRET` live only as Edge Function secrets —
  never in frontend code.
- Always validate the webhook signature before processing anything — it's
  the only proof a request actually came from Meta.
- `mensajes_procesados` is cheap insurance against a Meta retry duplicating
  a reply or double-charging your AI provider.
- The `/api/meta-conectar` code exchange must run server-side, never in the
  browser.
