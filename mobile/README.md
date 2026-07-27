# SMYL — app nativa (Capacitor)

Empaqueta las dos apps web del repo (`simulacion.html` y `revision-clinica.html`) como una
sola app nativa para Android e iOS, usando [Capacitor](https://capacitorjs.com/).

## Qué hay aquí

- `www/index.html` — pantalla de bienvenida con dos accesos: **Paciente** (simulación) y
  **Dentista** (revisión clínica).
- `www/simulacion.html`, `www/revision-clinica.html`, `www/icons/` — copias sincronizadas
  desde la raíz del repo (ver `npm run sync:web`). **No edites estos archivos aquí
  directamente** — edítalos en la raíz del repo y vuelve a sincronizar.
- `capacitor.config.json` — `appId: com.smyl.app`, `appName: SMYL`, `webDir: www`.
- `android/` — proyecto nativo de Android ya generado (`npx cap add android`).
- `ios/` — **todavía no generado** (ver abajo, requiere Mac).

## Flujo de trabajo

Cada vez que cambies `simulacion.html` o `revision-clinica.html` en la raíz del repo:

```bash
cd mobile
npm run cap:sync     # copia los HTML/icons más recientes a www/ y sincroniza los proyectos nativos
```

## Compilar para Android

Este sandbox **no tiene el Android SDK** y el proxy de red bloquea `dl.google.com`
(el host desde donde se descarga), así que la compilación real del APK no se puede hacer
desde aquí. El proyecto nativo (`android/`) ya está generado y listo — para compilarlo
necesitas hacerlo en una máquina con Android Studio instalado:

```bash
cd mobile
npm install
npm run android:open   # abre el proyecto en Android Studio
```

Desde Android Studio: `Build > Build Bundle(s) / APK(s) > Build APK(s)` (o `Generate Signed
Bundle` para subirlo a Play Store).

## Compilar para iOS

Generar y compilar el proyecto de iOS **requiere macOS con Xcode instalado** — no es posible
desde Linux ni desde este sandbox. Opciones:

1. **Mac propia o rentada** (ej. MacStadium, un Mac Mini en la nube): ahí correr
   `npx cap add ios`, abrir en Xcode, compilar y subir a App Store Connect.
2. **Servicio de build en la nube** (sin necesitar Mac propia): [Codemagic](https://codemagic.io/)
   o [Expo EAS Build](https://expo.dev/eas) pueden compilar proyectos de Capacitor para iOS
   sin que tengas una Mac — subes el repo y ellos compilan usando sus Macs en la nube.

En cualquiera de los dos casos, el `capacitor.config.json` y el `www/` ya están listos; solo
falta correr `npx cap add ios` en un entorno con Xcode disponible.

## Notas

- Las dos apps HTML no dependen de rutas absolutas (`/...`), así que funcionan igual de bien
  cargadas desde `file://`/`capacitor://` dentro del WebView nativo que desde GitHub Pages.
- El `sw.js` (service worker) de la PWA web no se usa en la app nativa — Capacitor no lo
  necesita para que la app funcione offline-first.
