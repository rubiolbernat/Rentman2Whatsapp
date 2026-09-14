# Rentman → WhatsApp (Electron)

App d'escriptori (Windows, macOS, Linux) fet amb Electron. Substitueix
l'intent amb Flutter: **aquí no hi ha sidecar, ni Node portàtil, ni còpies
manuals després del build** — Electron ja porta Node integrat, així que el
backend viu directament dins del mateix procés de l'app.

## Estructura

```
main.js              Procés principal d'Electron: arrenca el backend (require directe,
                      sense subprocessos) i obre la finestra.
renderer/             La interfície (HTML/CSS/JS pla, sense frameworks).
  index.html
  style.css
  app.js
  E91.png              <- POSA AQUÍ el teu logo (mateix nom que abans)
backend/               El mateix backend Express que ja tenies (sense canvis de lògica).
  server.js
  src/
    rentman.js
    whatsapp.js
    store.js
    cleanup.js
    routes/
.puppeteerrc.cjs       Fa que el Chromium de Puppeteer es baixi DINS del projecte
                        (a .puppeteer-cache/), perquè es pugui empaquetar amb l'app.
package.json            Dependències + configuració d'electron-builder.
```

## Posada en marxa (desenvolupament)

```bash
npm install
npm start
```

Això obre directament la finestra de l'app — el backend arrenca sol dins
del mateix procés, no cal cap segon terminal ni `npm start` per separat
dins de cap carpeta `backend/`.

La primera vegada, `npm install` trigarà una mica: baixa, entre altres
coses, un Chromium sencer per a Puppeteer (uns 200 MB), ara cap a
`.puppeteer-cache/` gràcies a `.puppeteerrc.cjs`.

## Empaquetar per distribuir

```bash
npm run dist:win     # genera un instal·lador .exe (NSIS) a dist/
npm run dist:mac     # genera un .dmg
npm run dist:linux   # genera un AppImage
```

**Ja està.** `electron-builder` s'encarrega de tot: empaqueta el backend,
`node_modules` (Puppeteer/Chromium inclòs, gràcies a `.puppeteer-cache/`
dins del projecte) i la interfície en un sol instal·lador, sense passos
manuals de còpia. El resultat és un executable que un usuari final pot
instal·lar sense tenir Node ni res més instal·lat al seu ordinador.

Nota: per compilar per a Windows/macOS necessites fer-ho des del sistema
operatiu corresponent (o amb CI, p. ex. GitHub Actions amb runners de
cada SO) — això és una limitació de les eines de compilació natives, no
d'aquest projecte en concret.

## On es guarden les dades de l'usuari

`main.js` configura el backend perquè guardi la sessió de WhatsApp i els
vincles projecte↔grup a la carpeta d'usuari pròpia del sistema operatiu
(`app.getPath('userData')` d'Electron — a Windows dins de `%APPDATA%`, a
macOS dins de `~/Library/Application Support`), no dins de la carpeta de
l'app. Així sobreviuen a actualitzacions i desinstal·lacions parcials.

El token de Rentman, el prefix de país i els "números fixos" es guarden
amb `localStorage` del propi Chromium d'Electron (equivalent al que feia
abans el navegador).

## Diferències respecte a la versió Flutter

- No cal cap URL de backend configurable: sempre és `http://127.0.0.1:3001`,
  perquè backend i interfície viuen al mateix ordinador per definició.
- No hi ha botó de "reiniciar backend": si mai cal, simplement tanca i
  torna a obrir l'app (Ctrl+R també recarrega només la finestra, sense
  reiniciar el backend — útil si la interfície es queda penjada però el
  backend va bé).
- Neteja de grups: exactament igual que abans — mai automàtica, sempre es
  dispara des de la pestanya Manteniment o el botó "Eliminar grup ara".
- **Icones pròpies en SVG** (sense emojis) a tota la interfície.
- **Pestanya "Historial"** nova: registre de qui s'ha creat, netejat,
  sincronitzat, canviat de nom o rebut un missatge, i quan.
- **Enviament massiu**: a Manteniment, pots seleccionar diversos grups
  vinculats i enviar-los de cop el contingut d'un camp (p. ex. `custom_1`),
  llegit per separat del projecte de cada grup.
- **Notificacions d'escriptori** quan acaba una acció important (grup
  creat, missatge enviat, neteja feta).

## Actualitzacions automàtiques

L'app comprova sola si hi ha una versió nova (via `electron-updater`,
contra "Releases" d'un repositori de GitHub — gratuït, no cal servidor
propi). Quan la té descarregada, pregunta si vols reiniciar per
instal·lar-la. Només funciona en un build empaquetat de veritat (`npm
start` en desenvolupament no la comprova).

### Configuració (un sol cop)

1. Crea un repositori a GitHub (pot ser privat).
2. A `package.json`, dins de `"build"."publish"`, posa el teu usuari i el
   nom del repositori:
   ```json
   "publish": {
     "provider": "github",
     "owner": "el-teu-usuari",
     "repo": "el-nom-del-repositori"
   }
   ```
3. Copia `.env.example` a `.env` (aquest sí que es pot moure d'ordinador
   sense dependre de res del sistema — i ja està exclòs del `.gitignore`,
   no es pujarà mai al repositori) i enganxa-hi el token:
   ```
   GH_TOKEN=ghp_el_teu_token_aqui
   ```

### Publicar una versió nova

1. Puja el número de `"version"` a `package.json` (p. ex. `1.0.1`).
2. Publica:
   ```bash
   npm run publish:win
   ```
   Això compila l'app **i** la puja com a "Release" al repositori de
   GitHub, amb els fitxers que `electron-updater` necessita per detectar
   la novetat. Els usuaris que ja tinguin l'app oberta la rebran sola en
   un parell d'hores (o abans, si la tanquen i la tornen a obrir).

Si mai `whatsapp-web.js` necessita una actualització (per un canvi intern
de WhatsApp, no relacionat amb la versió que ja es resol sola — vegeu
més amunt), el procés és: pujar la versió a `package.json`, `npm
install`, `npm version patch` (o similar) i `npm run publish:win` —
tothom rep el fix sol, sense haver de tornar a instal·lar res a mà.

## Logo / icona de l'app

Hi ha dos llocs on posar-lo:

1. **`renderer/E91.png`** — el logo que es veu dins de la interfície (barra lateral). Qualsevol mida rectangular normal (p. ex. 128×128) va bé.
2. **`build/icon.png`** — la icona de l'executable/instal·lador final (la que es veu a l'escriptori, la barra de tasques, el `.exe`...). Crea la carpeta `build/` a l'arrel del projecte si no hi és, i posa-hi un PNG **quadrat i d'alta resolució (mínim 512×512, millor 1024×1024)**. `electron-builder` genera automàticament el `.ico` (Windows) i el `.icns` (macOS) a partir d'aquest sol fitxer — no cal convertir res a mà.

Si no poses cap dels dos, l'app funciona igual, simplement sense icona pròpia (mostra la icona genèrica d'Electron).