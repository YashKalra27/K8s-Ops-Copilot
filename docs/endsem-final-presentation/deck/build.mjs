// Builds the end-semester deck: slides.src.html -> slides.html (icons inlined) -> vector PDF + PNG previews.
// Uses playwright-core from the midsem deck (node_modules is a symlink to ../../midsem-presentation/node_modules).
import { chromium } from "playwright-core"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, "build")
mkdirSync(out, { recursive: true })
// SRC / PDF let one pipeline build several decks (e.g. SRC=slides-genai.src.html).
const SRC = process.env.SRC ?? "slides.src.html"
const pdf = process.env.PDF ?? path.join(here, "..", "SRE-Copilot-Final-Presentation.pdf")
const built = SRC.replace(".src.html", ".html")
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

let html = readFileSync(path.join(here, SRC), "utf8")
const missing = new Set()
html = html.replace(/<i class="ic" data-i="([a-z-]+)"><\/i>/g, (_, n) => {
  try {
    return `<span class="ic">${readFileSync(path.join(here, "assets/icons", `${n}.svg`), "utf8")}</span>`
  } catch {
    missing.add(n)
    return ""
  }
})
if (missing.size) throw new Error("missing icons: " + [...missing].join(", "))
if (/[—–]/.test(html)) throw new Error("em or en dash found in the slides")
writeFileSync(path.join(here, built), html)

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(path.join(here, built)).href)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)
const slides = await page.$$("section.slide")
const tag = SRC === "slides.src.html" ? "slide" : SRC.replace(".src.html", "")
for (let i = 0; i < slides.length; i++) await slides[i].screenshot({ path: path.join(out, `${tag}-${i}.png`) })
await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log(`Built ${slides.length} slides -> ${pdf}`)
