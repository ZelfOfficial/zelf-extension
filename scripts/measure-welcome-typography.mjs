/**
 * Measures effective subtitle font size on onboarding/login screens at 1366×768.
 * Run: node scripts/measure-welcome-typography.mjs [--base=v4|HEAD]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4173;
const viewport = { width: 1366, height: 768 };

const routes = [
    { name: "Onboarding carousel", hash: "#/welcome-zelfid", selector: ".welcome-onboarding__description, .welcome-onboarding p" },
    { name: "Login / claim tag", hash: "#/welcome-zelfid/claim", selector: ".zelf-card__subtitle" },
    { name: "Find Zelf ID", hash: "#/welcome-zelfid/find", selector: ".zelf-card__subtitle, .welcome-find__subtitle" },
    { name: "Unlock password", hash: "#/security-zelfid/password", selector: ".zelf-card__subtitle" },
];

async function main() {
    const server = spawn("npx", ["--yes", "http-server", "dist/prod", "-p", String(port), "-c-1", "--silent"], {
        cwd: root,
        stdio: "ignore",
    });

    await new Promise((r) => setTimeout(r, 1500));

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize(viewport);

    const rows = [];
    for (const route of routes) {
        await page.goto(`http://127.0.0.1:${port}/index.html${route.hash}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
            document.documentElement.classList.add("main-div--fullscreen");
            document.body.querySelector(".main-div")?.classList.add("main-div--fullscreen");
        });
        const size = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const px = parseFloat(getComputedStyle(el).fontSize);
            return Number.isFinite(px) ? Math.round(px * 10) / 10 : null;
        }, route.selector);
        rows.push({ screen: route.name, px: size ?? "n/a" });
    }

    await browser.close();
    server.kill("SIGTERM");

    console.log(JSON.stringify({ viewport, rows }, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
