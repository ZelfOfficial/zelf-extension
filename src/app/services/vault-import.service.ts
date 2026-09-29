import { Injectable } from "@angular/core";
import { WalletService } from "../wallet.service";
import { ZelfKeysService } from "./zelf-keys.service";

export type ImportProvider =
    | "auto"
    | "lastpass"
    | "bitwarden_csv"
    | "bitwarden_json"
    | "1password"
    | "chrome"
    | "apple"
    | "keepassxc"
    | "generic_csv";

export interface ImportProviderOption {
    id: ImportProvider;
    name: string;
    description: string;
}

export interface ImportableCredential {
    id: string;
    title: string;
    website: string;
    username: string;
    password: string;
    notes?: string;
    folder?: string;
    selected: boolean;
}

export interface ImportParseResult {
    detectedProvider: ImportProvider;
    credentials: ImportableCredential[];
    errors: string[];
    totalFound: number;
}

export interface ImportBatchProgress {
    current: number;
    total: number;
    title: string;
}

@Injectable({
    providedIn: "root",
})
export class VaultImportService {
    readonly providerOptions: ImportProviderOption[] = [
        {
            id: "auto",
            name: "Auto-detect Format",
            description: "Automatically identify the password manager schema",
        },
        {
            id: "lastpass",
            name: "LastPass CSV",
            description: "url, username, password, extra, name, grouping, fav",
        },
        {
            id: "bitwarden_csv",
            name: "Bitwarden CSV",
            description: "login_uri, login_username, login_password, folder, etc.",
        },
        {
            id: "bitwarden_json",
            name: "Bitwarden JSON",
            description: "Standard unencrypted Bitwarden JSON export",
        },
        {
            id: "1password",
            name: "1Password CSV",
            description: "Title, URL, Username, Password, Notes",
        },
        {
            id: "chrome",
            name: "Google Chrome / Passwords CSV",
            description: "name, url, username, password, note",
        },
        {
            id: "apple",
            name: "Apple Passwords / iCloud CSV",
            description: "Title, URL, Username, Password, Notes, OTPAuth",
        },
        {
            id: "keepassxc",
            name: "KeePassXC CSV",
            description: "Group, Title, Username, Password, URL, Notes",
        },
        {
            id: "generic_csv",
            name: "Generic CSV",
            description: "Any CSV with website/URL, username, and password columns",
        },
    ];

    constructor(
        private _walletService: WalletService,
        private _zelfKeysService: ZelfKeysService
    ) {}

    /**
     * Parses RFC 4180 CSV text handling quoted fields, commas inside quotes,
     * doubled quotes (""), and multiline cells.
     */
    parseCsvRows(csvText: string): string[][] {
        // Strip BOM if present
        let cleanText = csvText.replace(/^\uFEFF/, "");
        const rows: string[][] = [];
        let currentRow: string[] = [];
        let currentField = "";
        let insideQuotes = false;

        for (let i = 0; i < cleanText.length; i++) {
            const char = cleanText[i];
            const nextChar = cleanText[i + 1];

            if (insideQuotes) {
                if (char === '"') {
                    if (nextChar === '"') {
                        // Escaped quote
                        currentField += '"';
                        i++;
                    } else {
                        // Closing quote
                        insideQuotes = false;
                    }
                } else {
                    currentField += char;
                }
            } else {
                if (char === '"') {
                    insideQuotes = true;
                } else if (char === ",") {
                    currentRow.push(currentField);
                    currentField = "";
                } else if (char === "\r") {
                    if (nextChar === "\n") i++;
                    currentRow.push(currentField);
                    if (currentRow.some((f) => f.trim().length > 0)) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentField = "";
                } else if (char === "\n") {
                    currentRow.push(currentField);
                    if (currentRow.some((f) => f.trim().length > 0)) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentField = "";
                } else {
                    currentField += char;
                }
            }
        }

        if (currentField.length > 0 || currentRow.length > 0) {
            currentRow.push(currentField);
            if (currentRow.some((f) => f.trim().length > 0)) {
                rows.push(currentRow);
            }
        }

        return rows;
    }

    /**
     * Detects provider format based on file content.
     */
    detectProvider(text: string): ImportProvider {
        const trimmed = text.trim();

        // Check if JSON
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed.items) || (parsed.encrypted === false && parsed.items)) {
                    return "bitwarden_json";
                }
            } catch {
                // Not valid JSON, continue with CSV check
            }
        }

        const rows = this.parseCsvRows(trimmed);
        if (rows.length === 0) return "generic_csv";

        const headers = rows[0].map((h) => h.trim().toLowerCase());
        const headerOriginals = rows[0].map((h) => h.trim());

        // Bitwarden CSV has distinct headers
        if (headers.includes("login_uri") || headers.includes("login_password") || headers.includes("reprompt")) {
            return "bitwarden_csv";
        }

        // Apple Passwords has OTPAuth and Title
        if (headers.includes("otpauth") || headerOriginals.includes("OTPAuth")) {
            return "apple";
        }

        // KeePassXC has Group, Title, URL
        if (headers.includes("group") && headers.includes("title") && headers.includes("url")) {
            return "keepassxc";
        }

        // LastPass has grouping and fav or extra
        if (headers.includes("grouping") || headers.includes("fav") || (headers.includes("extra") && headers.includes("url"))) {
            return "lastpass";
        }

        // 1Password has Title (capitalized) and URL, Username, Password, Notes
        if (headerOriginals.includes("Title") && headerOriginals.includes("URL") && headerOriginals.includes("Username")) {
            return "1password";
        }

        // Google Chrome has lowercase name, url, username, password
        if (headers.includes("name") && headers.includes("url") && headers.includes("username") && headers.includes("password")) {
            return "chrome";
        }

        return "generic_csv";
    }

    /**
     * Derives a clean title/hostname from URL or title field.
     */
    private _cleanTitle(title?: string, url?: string): string {
        if (title?.trim()) return title.trim();
        if (url?.trim()) {
            try {
                const u = new URL(url.includes("://") ? url : `https://${url}`);
                return u.hostname;
            } catch {
                return url.trim();
            }
        }
        return "Imported Password";
    }

    /**
     * Normalizes a website URL.
     */
    private _normalizeUrl(url?: string): string {
        if (!url) return "";
        const trimmed = url.trim();
        if (!trimmed) return "";
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    /**
     * Parse raw file content into normalized credentials.
     */
    parseContent(content: string, forcedProvider?: ImportProvider): ImportParseResult {
        const text = content.trim();
        const errors: string[] = [];
        const detectedProvider =
            forcedProvider && forcedProvider !== "auto" ? forcedProvider : this.detectProvider(text);

        // Bitwarden JSON
        if (detectedProvider === "bitwarden_json") {
            try {
                const parsed = JSON.parse(text);
                const items = Array.isArray(parsed.items) ? parsed.items : [];
                const folderMap = new Map<string, string>();

                if (Array.isArray(parsed.folders)) {
                    parsed.folders.forEach((f: any) => {
                        if (f?.id && f?.name) folderMap.set(f.id, f.name);
                    });
                }

                const credentials: ImportableCredential[] = [];
                items.forEach((item: any, idx: number) => {
                    // Type 1 is Login in Bitwarden
                    const login = item.login || {};
                    const primaryUri = Array.isArray(login.uris) && login.uris.length > 0 ? login.uris[0]?.uri || "" : "";
                    const username = login.username || "";
                    const password = login.password || "";

                    if (!password && !username && !primaryUri) {
                        return; // Skip empty items or non-logins
                    }

                    credentials.push({
                        id: `import-${idx + 1}-${Date.now()}`,
                        title: this._cleanTitle(item.name, primaryUri),
                        website: this._normalizeUrl(primaryUri),
                        username,
                        password,
                        notes: item.notes || "",
                        folder: item.folderId ? folderMap.get(item.folderId) || "" : "",
                        selected: true,
                    });
                });

                return {
                    detectedProvider,
                    credentials,
                    errors,
                    totalFound: credentials.length,
                };
            } catch (err: any) {
                errors.push(`JSON parsing failed: ${err?.message || "Invalid JSON"}`);
                return { detectedProvider, credentials: [], errors, totalFound: 0 };
            }
        }

        // CSV parsing
        const rows = this.parseCsvRows(text);
        if (rows.length < 2) {
            errors.push("No data rows found in CSV file.");
            return { detectedProvider, credentials: [], errors, totalFound: 0 };
        }

        const rawHeaders = rows[0];
        const lowerHeaders = rawHeaders.map((h) => h.trim().toLowerCase());
        const dataRows = rows.slice(1);

        const getCol = (names: string[]): number => {
            for (const name of names) {
                const idx = lowerHeaders.indexOf(name.toLowerCase());
                if (idx !== -1) return idx;
            }
            return -1;
        };

        let titleCol = -1;
        let urlCol = -1;
        let userCol = -1;
        let passCol = -1;
        let notesCol = -1;
        let folderCol = -1;

        switch (detectedProvider) {
            case "lastpass":
                urlCol = getCol(["url"]);
                userCol = getCol(["username"]);
                passCol = getCol(["password"]);
                notesCol = getCol(["extra", "notes"]);
                titleCol = getCol(["name"]);
                folderCol = getCol(["grouping"]);
                break;

            case "bitwarden_csv":
                folderCol = getCol(["folder"]);
                titleCol = getCol(["name"]);
                notesCol = getCol(["notes"]);
                urlCol = getCol(["login_uri", "uri", "url"]);
                userCol = getCol(["login_username", "username"]);
                passCol = getCol(["login_password", "password"]);
                break;

            case "1password":
                titleCol = getCol(["title"]);
                urlCol = getCol(["url", "website"]);
                userCol = getCol(["username", "user"]);
                passCol = getCol(["password"]);
                notesCol = getCol(["notes", "note"]);
                break;

            case "chrome":
                titleCol = getCol(["name"]);
                urlCol = getCol(["url"]);
                userCol = getCol(["username"]);
                passCol = getCol(["password"]);
                notesCol = getCol(["note", "notes"]);
                break;

            case "apple":
                titleCol = getCol(["title"]);
                urlCol = getCol(["url"]);
                userCol = getCol(["username"]);
                passCol = getCol(["password"]);
                notesCol = getCol(["notes"]);
                break;

            case "keepassxc":
                folderCol = getCol(["group"]);
                titleCol = getCol(["title"]);
                userCol = getCol(["username"]);
                passCol = getCol(["password"]);
                urlCol = getCol(["url"]);
                notesCol = getCol(["notes"]);
                break;

            case "generic_csv":
            default:
                titleCol = getCol(["title", "name", "application", "app"]);
                urlCol = getCol(["url", "website", "login_uri", "uri", "site", "domain"]);
                userCol = getCol(["username", "user", "email", "login", "account"]);
                passCol = getCol(["password", "pass", "secret"]);
                notesCol = getCol(["notes", "note", "extra", "comment", "comments", "description"]);
                folderCol = getCol(["folder", "group", "grouping", "category"]);
                break;
        }

        // Validate minimum required columns (at least password or username or url)
        if (passCol === -1 && userCol === -1) {
            errors.push("Could not find username or password columns in the CSV file.");
            return { detectedProvider, credentials: [], errors, totalFound: 0 };
        }

        const credentials: ImportableCredential[] = [];

        dataRows.forEach((row, idx) => {
            const rawPassword = passCol !== -1 && row[passCol] ? row[passCol].trim() : "";
            const rawUsername = userCol !== -1 && row[userCol] ? row[userCol].trim() : "";
            const rawUrl = urlCol !== -1 && row[urlCol] ? row[urlCol].trim() : "";
            const rawTitle = titleCol !== -1 && row[titleCol] ? row[titleCol].trim() : "";
            const rawNotes = notesCol !== -1 && row[notesCol] ? row[notesCol].trim() : "";
            let rawFolder = folderCol !== -1 && row[folderCol] ? row[folderCol].trim() : "";

            // If KeePassXC "Root/Work", strip "Root/"
            if (rawFolder.startsWith("Root/")) {
                rawFolder = rawFolder.replace(/^Root\//, "");
            } else if (rawFolder === "Root") {
                rawFolder = "";
            }

            // Skip completely empty rows
            if (!rawPassword && !rawUsername && !rawUrl && !rawTitle) {
                return;
            }

            const cleanUrl = this._normalizeUrl(rawUrl);
            const cleanTitle = this._cleanTitle(rawTitle, cleanUrl || rawUrl);

            credentials.push({
                id: `import-${idx + 1}-${Date.now()}`,
                title: cleanTitle,
                website: cleanUrl || rawTitle,
                username: rawUsername,
                password: rawPassword,
                notes: rawNotes,
                folder: rawFolder,
                selected: true,
            });
        });

        return {
            detectedProvider,
            credentials,
            errors,
            totalFound: credentials.length,
        };
    }

    /**
     * Batch stores parsed credentials in ZelfKeys using a single captured selfie proof.
     */
    async importBatch(
        credentials: ImportableCredential[],
        faceBase64: string,
        masterPassword?: string,
        onProgress?: (progress: ImportBatchProgress) => void
    ): Promise<{ succeeded: number; failed: { credential: ImportableCredential; error: string }[] }> {
        const wallet = await this._walletService.getCurrentWallet();
        if (!wallet?.zelfProof) {
            throw new Error("Active wallet with zelfProof is required to store passwords.");
        }

        const selected = credentials.filter((c) => c.selected);
        const total = selected.length;
        let succeeded = 0;
        const failed: { credential: ImportableCredential; error: string }[] = [];

        for (let i = 0; i < total; i++) {
            const cred = selected[i];
            if (onProgress) {
                onProgress({ current: i + 1, total, title: cred.title });
            }

            try {
                const payload = {
                    name: cred.title,
                    website: cred.website || cred.title,
                    username: cred.username || "",
                    password: cred.password || "",
                    alias: cred.title,
                    folder: cred.folder || undefined,
                    insideFolder: !!cred.folder,
                    notes: cred.notes || undefined,
                    faceBase64,
                    masterPassword: wallet.hasPassword ? masterPassword : undefined,
                    zelfProof: wallet.zelfProof,
                };

                await this._zelfKeysService.storePasswordWithAuth(payload);
                succeeded++;
            } catch (err: any) {
                console.warn(`Failed to import credential "${cred.title}":`, err);
                failed.push({
                    credential: cred,
                    error: err?.error?.error || err?.error?.message || err?.message || "Storage failed",
                });
            }
        }

        return { succeeded, failed };
    }
}
