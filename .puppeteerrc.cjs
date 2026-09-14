// .puppeteerrc.cjs
// Fitxer de configuracio oficial de Puppeteer (el llegeix tant a "npm
// install" com en temps d'execucio quan es fa puppeteer.launch()).
// Sense aixo, Puppeteer baixaria el Chromium a la cache global de
// l'usuari (~/.cache/puppeteer), fora del projecte, i electron-builder
// no el podria empaquetar dins de l'app final.
const { join } = require("path");

module.exports = {
  cacheDirectory: join(__dirname, ".puppeteer-cache"),
};
