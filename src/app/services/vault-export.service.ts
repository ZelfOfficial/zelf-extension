import { Injectable } from "@angular/core";
import { VaultService } from "../vault.service";
import { ZelfKeysProofService } from "./zelf-keys-proof.service";
import { ZelfKeysService } from "./zelf-keys.service";

export type ExportFormat =
    | "lastpass"
    | "bitwarden_csv"
    | "bitwarden_json"
    | "1password"
    | "chrome"
    | "apple"
    | "keepassxc";

export interface ExportFormatOption {
    id: ExportFormat;
    name: string;
    description: string;
    extension: "csv" | "json";
    mimeType: string;
}

export interface ExportableCredential {
    title?: string;
    website?: string;
    username?: string;
    password?: string;
    notes?: string;
    folder?: string;
    alias?: string;
    favorite?: boolean;
}

export interface DecryptBatchProgress {
    current: number;
    total: number;
    title: string;
}

@Injectable({
    providedIn: "root",
})
export class VaultExportService {
    readonly formatOptions: ExportFormatOption[] = [
        {
            id: "lastpass",
            name: "LastPass (Universal CSV)",
            description: "Compatible with LastPass, Bitwarden, 1Password, Chrome, Apple, and KeePassXC",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
        {
            id: "bitwarden_csv",
            name: "Bitwarden (CSV)",
            description: "Standard Bitwarden import format with login URIs and folders",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
        {
            id: "bitwarden_json",
            name: "Bitwarden (JSON)",
            description: "Standard unencrypted Bitwarden JSON export structure",
            extension: "json",
            mimeType: "application/json;charset=utf-8;",
        },
        {
            id: "1password",
            name: "1Password (CSV)",
            description: "Title, URL, Username, Password, Notes format",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
        {
            id: "chrome",
            name: "Google Chrome / Password Manager (CSV)",
            description: "name, url, username, password, note format",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
        {
            id: "apple",
            name: "Apple Passwords / iCloud Keychain (CSV)",
            description: "Title, URL, Username, Password, Notes, OTPAuth format",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
        {
            id: "keepassxc",
            name: "KeePassXC (CSV)",
            description: "Group, Title, Username, Password, URL, Notes format",
            extension: "csv",
            mimeType: "text/csv;charset=utf-8;",
        },
    ];

    constructor(
        private _vaultService: VaultService,
        private _zelfKeysProofService: ZelfKeysProofService,
        private _zelfKeysService: ZelfKeysService
    ) {}

    /**
     * Escape a single field following RFC 4180 rules.
     */
    private _escapeCsvField(value: any): string {
        if (value === null || value === undefined) return "";
        const str = String(value);
        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    /**
     * Build CSV string from rows with UTF-8 BOM.
     */
    private _buildCsv(headers: string[], rows: string[][]): string {
        const headerLine = headers.map((h) => this._escapeCsvField(h)).join(",");
        const dataLines = rows.map((row) => row.map((val) => this._escapeCsvField(val)).join(","));
        // Prepend UTF-8 BOM so Excel and desktop password managers recognize UTF-8 encoding
        return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
    }

    /**
     * Clean website URL to ensure proper formatting for export.
     */
    private _normalizeUrl(url: string | undefined): string {
        if (!url) return "";
        const trimmed = url.trim();
        if (!trimmed) return "";
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    /**
     * Derives a clean title/name for an item.
     */
    private _deriveTitle(item: ExportableCredential): string {
        if (item.title?.trim()) return item.title.trim();
        if (item.alias?.trim()) return item.alias.trim();
        if (item.website?.trim()) {
            try {
                const u = new URL(this._normalizeUrl(item.website));
                return u.hostname;
            } catch {
                return item.website.trim();
            }
        }
        return "Password";
    }

    /**
     * Exports credentials into the chosen provider format.
     */
    exportToString(format: ExportFormat, credentials: ExportableCredential[]): string {
        switch (format) {
            case "lastpass":
                return this._exportLastPass(credentials);
            case "bitwarden_csv":
                return this._exportBitwardenCsv(credentials);
            case "bitwarden_json":
                return this._exportBitwardenJson(credentials);
            case "1password":
                return this._export1Password(credentials);
            case "chrome":
                return this._exportChrome(credentials);
            case "apple":
                return this._exportApple(credentials);
            case "keepassxc":
                return this._exportKeePassXC(credentials);
            default:
                return this._exportLastPass(credentials);
        }
    }

    /**
     * LastPass CSV format:
     * url,username,password,extra,name,grouping,fav
     */
    private _exportLastPass(credentials: ExportableCredential[]): string {
        const headers = ["url", "username", "password", "extra", "name", "grouping", "fav"];
        const rows = credentials.map((item) => [
            this._normalizeUrl(item.website),
            item.username || "",
            item.password || "",
            item.notes || "",
            this._deriveTitle(item),
            item.folder || "",
            item.favorite ? "1" : "0",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * Bitwarden CSV format:
     * folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
     */
    private _exportBitwardenCsv(credentials: ExportableCredential[]): string {
        const headers = [
            "folder",
            "favorite",
            "type",
            "name",
            "notes",
            "fields",
            "reprompt",
            "login_uri",
            "login_username",
            "login_password",
            "login_totp",
        ];
        const rows = credentials.map((item) => [
            item.folder || "",
            item.favorite ? "1" : "0",
            "login",
            this._deriveTitle(item),
            item.notes || "",
            "",
            "0",
            this._normalizeUrl(item.website),
            item.username || "",
            item.password || "",
            "",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * Bitwarden JSON format (unencrypted export standard).
     */
    private _exportBitwardenJson(credentials: ExportableCredential[]): string {
        // Collect distinct folders
        const folderSet = new Set<string>();
        credentials.forEach((c) => {
            if (c.folder?.trim()) folderSet.add(c.folder.trim());
        });
        const folders = Array.from(folderSet).map((name, index) => ({
            id: `folder-${index + 1}`,
            name,
        }));
        const folderMap = new Map<string, string>();
        folders.forEach((f) => folderMap.set(f.name, f.id));

        const items = credentials.map((item, index) => {
            const folderId = item.folder ? folderMap.get(item.folder) || null : null;
            const uri = this._normalizeUrl(item.website);
            return {
                id: `item-${index + 1}`,
                organizationId: null,
                folderId,
                type: 1, // 1 = Login
                reprompt: 0,
                name: this._deriveTitle(item),
                notes: item.notes || null,
                favorite: !!item.favorite,
                login: {
                    uris: uri ? [{ match: null, uri }] : [],
                    username: item.username || null,
                    password: item.password || null,
                    totp: null,
                },
            };
        });

        const json = {
            encrypted: false,
            folders,
            items,
        };

        return JSON.stringify(json, null, 2);
    }

    /**
     * 1Password CSV format:
     * Title,URL,Username,Password,Notes
     */
    private _export1Password(credentials: ExportableCredential[]): string {
        const headers = ["Title", "URL", "Username", "Password", "Notes"];
        const rows = credentials.map((item) => [
            this._deriveTitle(item),
            this._normalizeUrl(item.website),
            item.username || "",
            item.password || "",
            item.notes || "",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * Google Chrome / Password Manager CSV format:
     * name,url,username,password,note
     */
    private _exportChrome(credentials: ExportableCredential[]): string {
        const headers = ["name", "url", "username", "password", "note"];
        const rows = credentials.map((item) => [
            this._deriveTitle(item),
            this._normalizeUrl(item.website),
            item.username || "",
            item.password || "",
            item.notes || "",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * Apple Passwords / iCloud Keychain CSV format:
     * Title,URL,Username,Password,Notes,OTPAuth
     */
    private _exportApple(credentials: ExportableCredential[]): string {
        const headers = ["Title", "URL", "Username", "Password", "Notes", "OTPAuth"];
        const rows = credentials.map((item) => [
            this._deriveTitle(item),
            this._normalizeUrl(item.website),
            item.username || "",
            item.password || "",
            item.notes || "",
            "",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * KeePassXC CSV format:
     * Group,Title,Username,Password,URL,Notes
     */
    private _exportKeePassXC(credentials: ExportableCredential[]): string {
        const headers = ["Group", "Title", "Username", "Password", "URL", "Notes"];
        const rows = credentials.map((item) => [
            item.folder ? `Root/${item.folder}` : "Root",
            this._deriveTitle(item),
            item.username || "",
            item.password || "",
            this._normalizeUrl(item.website),
            item.notes || "",
        ]);
        return this._buildCsv(headers, rows);
    }

    /**
     * Helper to download the content as a file in the browser.
     */
    downloadFile(content: string, filename: string, mimeType: string): void {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Copy content to clipboard safely.
     */
    async copyToClipboard(content: string): Promise<boolean> {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(content);
                return true;
            }
            const textArea = document.createElement("textarea");
            textArea.value = content;
            textArea.style.position = "fixed";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const success = document.execCommand("copy");
            document.body.removeChild(textArea);
            return success;
        } catch (error) {
            console.error("Clipboard copy failed:", error);
            return false;
        }
    }

    /**
     * Sequentially decrypt an array of raw password vault items using a single selfie proof.
     */
    async decryptBatch(
        rawItems: any[],
        faceBase64: string,
        masterPassword?: string,
        onProgress?: (progress: DecryptBatchProgress) => void
    ): Promise<{ succeeded: ExportableCredential[]; failed: { item: any; error: string }[] }> {
        const succeeded: ExportableCredential[] = [];
        const failed: { item: any; error: string }[] = [];
        const total = rawItems.length;

        for (let i = 0; i < total; i++) {
            const raw = rawItems[i];
            let item = raw.raw || raw;
            const title =
                item.publicData?.title ||
                item.publicData?.website ||
                item.website ||
                item.title ||
                `Password #${i + 1}`;

            if (onProgress) {
                onProgress({ current: i + 1, total, title });
            }

            let zelfProof = item.zelfProof || item.publicData?.zelfProof;
            if (!zelfProof?.trim()) {
                try {
                    item = await this._zelfKeysProofService.ensureProof(item, { keysCategory: "passwords" });
                    zelfProof = item.zelfProof || item.publicData?.zelfProof;
                } catch (hydrateError) {
                    console.warn(`Failed to hydrate proof for ${title}:`, hydrateError);
                    failed.push({ item, error: "proof_load_failed" });
                    continue;
                }
            }

            if (!zelfProof?.trim()) {
                failed.push({ item, error: "proof_load_failed" });
                continue;
            }

            try {
                const { publicKey: clientPublicKey, privateKey: clientPrivateKey } =
                    await this._vaultService.generateEphemeralKeyPair();

                const versionHint = item.publicData?.v || item.v;
                const payload = {
                    zelfProof,
                    faceBase64,
                    type: "password",
                    clientPublicKey,
                    password: masterPassword || undefined,
                    ...(versionHint != null && String(versionHint).trim() ? { v: String(versionHint) } : {}),
                };

                const response = await this._zelfKeysService.retrieve(payload);
                const encryptedMessage = response?.data?.pgp?.encryptedMessage;
                const publicData = response?.data?.publicData || item.publicData || {};

                let decryptedData: any = response?.data?.metadata || {};
                if (encryptedMessage) {
                    const jsonData = await this._vaultService.decryptWithPrivateKey(
                        encryptedMessage,
                        clientPrivateKey
                    );
                    decryptedData = JSON.parse(jsonData);
                }

                succeeded.push({
                    title: publicData.title || decryptedData.title || title,
                    website: decryptedData.website || publicData.website || "",
                    username: decryptedData.username || publicData.username || "",
                    password: decryptedData.password || "",
                    notes: decryptedData.notes || publicData.notes || "",
                    folder: decryptedData.folder || publicData.folder || "",
                    alias: decryptedData.alias || publicData.alias || "",
                });
            } catch (err: any) {
                console.warn(`Failed to decrypt item ${title}:`, err);
                failed.push({
                    item,
                    error: err?.message || err?.error?.message || "Decryption failed",
                });
            }
        }

        return { succeeded, failed };
    }
}
