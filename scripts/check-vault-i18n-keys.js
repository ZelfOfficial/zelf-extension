#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Fail when a zelf_keys.vault.* key used in templates or TypeScript
 * is missing from src/assets/i18n/en.json (and the other locale files).
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const I18N_DIR = path.join(SRC_ROOT, "assets", "i18n");
const KEY_PATTERN = /['"`](zelf_keys\.vault\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)['"`]/g;

function walk(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, acc);
            continue;
        }
        if (/\.(html|ts)$/.test(entry.name)) acc.push(fullPath);
    }
    return acc;
}

function flatten(value, prefix = "", out = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;
    for (const [key, child] of Object.entries(value)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, fullKey, out);
        else out[fullKey] = child;
    }
    return out;
}

function usedVaultKeys() {
    const used = new Map();
    for (const filePath of walk(SRC_ROOT)) {
        const text = fs.readFileSync(filePath, "utf8");
        KEY_PATTERN.lastIndex = 0;
        let match = KEY_PATTERN.exec(text);
        while (match) {
            const key = match[1];
            if (!used.has(key)) used.set(key, []);
            used.get(key).push(path.relative(REPO_ROOT, filePath));
            match = KEY_PATTERN.exec(text);
        }
    }
    return used;
}

function main() {
    const used = usedVaultKeys();
    if (used.size === 0) {
        console.error("No zelf_keys.vault.* keys found under src/. The scanner is not looking at the right files.");
        process.exit(1);
    }

    const localeFiles = fs.readdirSync(I18N_DIR).filter((name) => name.endsWith(".json")).sort();
    const failures = [];

    for (const localeFile of localeFiles) {
        const locale = flatten(JSON.parse(fs.readFileSync(path.join(I18N_DIR, localeFile), "utf8")));
        for (const key of [...used.keys()].sort()) {
            const value = locale[key];
            if (typeof value !== "string" || value.trim() === "" || value === key) {
                const where = used.get(key).slice(0, 2).join(", ");
                failures.push(`${localeFile} missing ${key} (used in ${where})`);
            }
        }
    }

    if (failures.length) {
        console.error(`Vault translation check failed (${failures.length}):`);
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exit(1);
    }

    console.log(`Vault translation check passed (${used.size} zelf_keys.vault.* keys in ${localeFiles.length} locales).`);
}

main();
