import * as enJson from "../../assets/i18n/en.json";

/**
 * Keys the vault screen renders. scripts/check-vault-i18n-keys.js scans every
 * zelf_keys.vault.* literal under src/ and is wired into `npm test`.
 */
const VAULT_SCREEN_KEYS = [
    "zelf_keys.vault.add_menu",
    "zelf_keys.vault.add_new_card",
    "zelf_keys.vault.add_new_note",
    "zelf_keys.vault.add_new_password",
    "zelf_keys.vault.cancel",
    "zelf_keys.vault.empty_secure_card",
    "zelf_keys.vault.empty_secure_note",
    "zelf_keys.vault.empty_secure_password",
    "zelf_keys.vault.export_csv",
    "zelf_keys.vault.import_csv",
    "zelf_keys.vault.item",
    "zelf_keys.vault.items",
    "zelf_keys.vault.locked_title_cards",
    "zelf_keys.vault.locked_title_notes",
    "zelf_keys.vault.locked_title_passwords",
    "zelf_keys.vault.na",
    "zelf_keys.vault.no_items",
    "zelf_keys.vault.qr_code",
    "zelf_keys.vault.unknown",
    "zotp.refresh",
];

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === "default") {
            flatten(child, prefix, out);
            continue;
        }
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, fullKey, out);
        else if (typeof child === "string") out[fullKey] = child;
    }

    return out;
}

describe("vault and 2FA translation keys", () => {
    const en = flatten(enJson);

    it("defines copy for every vault and refresh key the screens render", () => {
        for (const key of VAULT_SCREEN_KEYS) {
            expect(en[key]).withContext(key).toEqual(jasmine.any(String));
            expect(en[key].trim().length).withContext(key).toBeGreaterThan(0);
            expect(en[key]).withContext(key).not.toBe(key);
        }
    });
});
