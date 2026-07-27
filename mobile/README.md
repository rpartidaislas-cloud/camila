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
- `ios/` — proyecto nativo de iOS ya generado (`npx cap add ios`) — resultó que este paso
  **no requiere macOS**, solo Node/npm, así que ya quedó listo en el repo.

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

El proyecto (`ios/`) ya está generado y en el repo — lo único que falta es **compilarlo**, y
eso sí requiere un entorno con Xcode (macOS). Como no hay Mac disponible, la opción es un
servicio de build en la nube:

**Codemagic** (recomendado, tiene plan gratis con minutos limitados y detecta proyectos
Capacitor automáticamente):

1. Crea cuenta en https://codemagic.io/ y conecta el repo de GitHub
   (`rpartidaislas-cloud/camila`).
2. Al agregar la app, Codemagic detecta que es un proyecto Capacitor/Xcode. Configura el
   workflow apuntando a `mobile/ios/App/App.xcodeproj` (o el `.xcworkspace` si usa Cocoapods)
   como el proyecto a compilar, y agrega un paso de build previo:
   ```bash
   cd mobile && npm install && npx cap sync ios
   ```
   (esto regenera `capacitor-cordova-ios-plugins/` y copia `www/` a `ios/App/App/public`,
   que están en `.gitignore` a propósito — ver nota abajo).
3. **Firma**: para compilar sin dispositivo real (solo simulador) no hace falta cuenta de
   pagada. Para instalar en un iPhone real o subir a TestFlight/App Store sí necesitas una
   cuenta de **Apple Developer** ($99 USD/año) — Codemagic tiene "automatic code signing"
   si conectas esa cuenta directo en su plataforma, no hace falta generar certificados a mano.
4. Cada vez que hagas push a la rama, Codemagic puede compilar el `.ipa` automáticamente y
   subirlo a TestFlight.

Alternativa: [Expo EAS Build](https://expo.dev/eas) también compila proyectos Capacitor en
la nube, con un flujo parecido.

## Notas

- Las dos apps HTML no dependen de rutas absolutas (`/...`), así que funcionan igual de bien
  cargadas desde `file://`/`capacitor://` dentro del WebView nativo que desde GitHub Pages.
- El `sw.js` (service worker) de la PWA web no se usa en la app nativa — Capacitor no lo
  necesita para que la app funcione offline-first.
