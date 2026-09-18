import { Logger } from "@extension-scripts/logger/logger.class";
import {
    BRIDGE_METHODS,
    BRIDGE_PROTOCOL_VERSION,
    ZelfBridgeEvent,
    ZelfBridgeRequest,
    ZelfBridgeResponse,
    ZelfKeysOperationAction,
    ZelfKeysPasswordList,
    ZelfKeysPasswordMetadata,
    ZelfSession,
} from "@shared/types/superapp.types";
import { DEFAULT_WEB_APP_NAME, PENDING_CONNECT_KEY, SuperappPendingConnect } from "@shared/utils/superapp-connect";
import { sanitizeSuperappPassword } from "@shared/utils/superapp-keys";
import { BackgroundCredentialManager } from "./background-credential-manager";
import { BrowserApiUtil } from "./browser-api-util";

const PORT_NAME = "zelf-superapp";
const UNLOCK_WINDOW_WIDTH = 440;
const UNLOCK_WINDOW_HEIGHT = 680;
const PENDING_KEYS_OPERATION_KEY = "superapp_pending_keys_operation";
const KEYS_OPERATION_TTL_MS = 5 * 60 * 1000;

const ADDRESS_FIELDS: Array<[string, string]> = [
    ["ethereum", "ethAddress"],
    ["solana", "solanaAddress"],
    ["bitcoin", "btcAddress"],
    ["stellar", "xlmAddress"],
    ["sui", "suiAddress"],
    ["ton", "tonAddress"],
    ["polygon", "polygonAddress"],
    ["avalanche", "avalancheAddress"],
    ["blockdag", "bdagAddress"],
    ["polkadot", "dotAddress"],
    ["kusama", "ksmAddress"],
];

interface PendingKeysOperation {
    requestId: string;
    action: ZelfKeysOperationAction;
    origin: string;
    appName?: string;
    draft?: {
        website: string;
        username: string;
        password: string;
        folder?: string | null;
        appName?: string;
    };
    itemId?: string;
    record?: {
        id: string;
        type: "password";
        zelfProof: string;
        publicData: {
            title: string;
            website: string;
            username: string;
        };
    };
    uiTabId?: number;
    expiresAt: number;
}

export class SuperappHandler {
    private static instance: SuperappHandler;
    private readonly ports = new Set<chrome.runtime.Port>();
    private readonly credentialManager: BackgroundCredentialManager;
    private keysWindowId: number | null = null;
    private lastSession: ZelfSession | null = null;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly browserApi: BrowserApiUtil) {
        this.credentialManager = BackgroundCredentialManager.getInstance(browserApi);
    }

    public static getInstance(browserApi: BrowserApiUtil): SuperappHandler {
        if (!SuperappHandler.instance) {
            SuperappHandler.instance = new SuperappHandler(browserApi);
        }

        return SuperappHandler.instance;
    }

    initialize(): void {
        if (typeof chrome === "undefined" || !chrome.runtime) {
            Logger.error("[SuperappHandler] runtime API is not available");
            return;
        }

        void this.cleanupExpiredKeysOperation();

        chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
            void this.handleExternalMessage(message, sender)
                .then(sendResponse)
                .catch((error: unknown) => {
                    sendResponse(
                        this.fail(
                            (message as ZelfBridgeRequest | undefined)?.id ?? "",
                            "INTERNAL",
                            error instanceof Error ? error.message : String(error)
                        )
                    );
                });

            return true;
        });

        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message?.type !== "ZELF_KEYS_OPERATION_COMPLETE") {
                return false;
            }

            void this.completeKeysOperation(message.payload)
                .then(() => sendResponse({ success: true }))
                .catch((error: unknown) =>
                    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) })
                );
            return true;
        });

        chrome.runtime.onConnectExternal.addListener((port) => {
            if (!this.isAllowedOrigin(port.sender?.origin)) {
                port.disconnect();
                return;
            }

            if (port.name && port.name !== PORT_NAME) {
                port.disconnect();
                return;
            }

            this.ports.add(port);
            this.startKeepAlive();
            port.onDisconnect.addListener(() => {
                this.ports.delete(port);
                if (this.ports.size === 0) {
                    this.stopKeepAlive();
                }
            });

            void this.readSession().then((session) => {
                this.lastSession = session;
                this.postToPort(port, {
                    type: session.locked ? "ZELF_LOCKED" : "ZELF_UNLOCKED",
                    session,
                });
            });
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local") {
                return;
            }

            if (changes.accessToken || changes.accessTokenExpiresAt || changes.wallet) {
                void this.broadcastSessionChange();
            }
        });

        if (chrome.windows?.onRemoved) {
            chrome.windows.onRemoved.addListener((windowId) => {
                if (windowId === this.keysWindowId) {
                    this.keysWindowId = null;
                    void this.cancelPendingKeysOperation();
                }
            });
        }

        chrome.tabs?.onRemoved?.addListener((tabId) => {
            void this.cancelPendingKeysOperation(tabId);
        });
    }

    private async handleExternalMessage(message: ZelfBridgeRequest, sender: chrome.runtime.MessageSender): Promise<ZelfBridgeResponse> {
        const id = typeof message?.id === "string" && message.id ? message.id : crypto.randomUUID();

        if (!this.isAllowedOrigin(sender.origin)) {
            return this.fail(id, "FORBIDDEN", "Origin is not allowed");
        }

        if (!message?.type || !String(message.type).startsWith("ZELF_")) {
            return this.fail(id, "UNSUPPORTED", "Unknown bridge method");
        }

        switch (message.type) {
            case "ZELF_HANDSHAKE":
                return this.ok(id, {
                    protocolVersion: BRIDGE_PROTOCOL_VERSION,
                    extensionVersion: chrome.runtime.getManifest().version,
                    methods: [...BRIDGE_METHODS],
                    capabilities: ["superapp"],
                });
            case "ZELF_GET_SESSION":
                return this.ok(id, await this.readSession());
            case "ZELF_REQUEST_UNLOCK":
                return this.ok(id, { opened: await this.openUnlockUi(sender, message.payload) });
            case "ZELF_KEYS_LIST_PASSWORDS":
                return this.ok(id, await this.listPasswords());
            case "ZELF_KEYS_OPEN_CREATE_PASSWORD":
                return this.ok(id, await this.openKeysOperation(id, "create", sender, message.payload));
            case "ZELF_KEYS_OPEN_REVEAL_PASSWORD":
                return this.ok(id, await this.openKeysOperation(id, "reveal", sender, message.payload));
            case "ZELF_KEYS_OPEN_DELETE_PASSWORD":
                return this.ok(id, await this.openKeysOperation(id, "delete", sender, message.payload));
            default:
                return this.fail(id, "UNSUPPORTED", `Unsupported method ${message.type}`);
        }
    }

    private async listPasswords(): Promise<ZelfKeysPasswordList> {
        await this.ensureKeysSession();
        const response = await this.credentialManager.listStoredPasswords();
        const rawItems = Array.isArray(response?.data?.data) ? response.data.data : [];
        const items = rawItems.map(sanitizeSuperappPassword).filter((item) => item !== null);
        return { items, totalCount: items.length };
    }

    private async ensureKeysSession(): Promise<void> {
        const session = await this.readSession();
        if (session.needsSetup) {
            throw new Error("Zelf ID setup is required");
        }
        if (session.locked) {
            throw new Error("Zelf extension is locked");
        }
    }

    private async openKeysOperation(
        requestId: string,
        action: ZelfKeysOperationAction,
        sender: chrome.runtime.MessageSender,
        payload?: unknown
    ): Promise<{ requestId: string; action: ZelfKeysOperationAction; opened: boolean }> {
        await this.ensureKeysSession();
        if (!sender.origin) {
            throw new Error("Missing request origin");
        }

        const payloadRecord = this.asRecord(payload);
        const appName = this.firstString(payloadRecord.appName) || DEFAULT_WEB_APP_NAME;

        const pending: PendingKeysOperation = {
            requestId,
            action,
            origin: sender.origin,
            appName,
            expiresAt: Date.now() + KEYS_OPERATION_TTL_MS,
        };

        if (action === "create") {
            const draftRecord = this.asRecord(payloadRecord.draft || payload);
            const website = this.firstString(draftRecord.website);
            const username = this.firstString(draftRecord.username);
            const password = this.firstString(draftRecord.password);
            const folder = this.firstString(draftRecord.folder) || null;
            const draftAppName = this.firstString(draftRecord.appName) || appName;
            if (!website || !username || !password) {
                throw new Error("Missing required password fields (website, username, password)");
            }
            pending.draft = {
                website,
                username,
                password,
                folder,
                appName: draftAppName,
            };
            pending.appName = draftAppName;
        } else {
            const itemId = this.firstString(payloadRecord.itemId);
            if (!itemId) {
                throw new Error("Password item id is required");
            }
            const response = await this.credentialManager.listStoredPasswords();
            const rawItems = Array.isArray(response?.data?.data) ? response.data.data : [];
            const rawRecord = rawItems.find((item) => this.firstString(item?.id, item?.cid) === itemId);
            const zelfProof = this.firstString(rawRecord?.zelfProof);
            if (!rawRecord || !zelfProof) {
                throw new Error("Password record not found");
            }
            const publicData = this.asRecord(rawRecord.publicData);
            pending.itemId = itemId;
            pending.record = {
                id: itemId,
                type: "password",
                zelfProof,
                publicData: {
                    title: this.firstString(publicData.alias, publicData.website) || "Password",
                    website: this.firstString(publicData.website),
                    username: this.firstString(publicData.username),
                },
            };
        }

        await chrome.storage.session.set({ [PENDING_KEYS_OPERATION_KEY]: pending });
        const opened = await this.openKeysUi(action, pending, sender);
        if (!opened) {
            await chrome.storage.session.remove(PENDING_KEYS_OPERATION_KEY);
            throw new Error("Failed to open Zelf Keys extension UI");
        }

        await chrome.storage.session.set({ [PENDING_KEYS_OPERATION_KEY]: pending });
        this.broadcastKeysOperation(pending, "opened");
        return { requestId, action, opened: true };
    }

    private async openKeysUi(
        action: ZelfKeysOperationAction,
        pending: PendingKeysOperation,
        sender?: chrome.runtime.MessageSender
    ): Promise<boolean> {
        const runtime = this.browserApi.runtime as { getURL?: (path: string) => string } | undefined;
        if (!runtime?.getURL) {
            return false;
        }

        const url = runtime.getURL(`index.html#/popout-decryptor?from=superapp&action=${action}`);

        // 1. If the extension popup is already open, navigate it directly
        if (chrome.extension?.getViews) {
            try {
                const popupViews = chrome.extension.getViews({ type: "popup" });
                if (popupViews.length > 0) {
                    popupViews[0].location.href = url;
                    return true;
                }
            } catch (err) {
                Logger.warn("[SuperappHandler] Failed to navigate open popup view:", err);
            }
        }

        // 2. Attempt to open the toolbar popup directly (preferred popup UX)
        const actionApi = this.browserApi.action as { openPopup?: (options?: { windowId?: number }) => Promise<void> } | undefined;
        if (actionApi?.openPopup) {
            try {
                const targetWindowId = sender?.tab?.windowId;
                if (targetWindowId != null) {
                    await actionApi.openPopup({ windowId: targetWindowId });
                } else {
                    await actionApi.openPopup();
                }
                return true;
            } catch (error) {
                Logger.warn("[SuperappHandler] action.openPopup failed, falling back to popup window:", error);
            }
        }

        // 3. If a previous fallback popup window is still open, reuse it
        if (this.keysWindowId != null) {
            try {
                const tabs = await chrome.tabs.query({ windowId: this.keysWindowId });
                if (tabs[0]?.id != null) {
                    await chrome.tabs.update(tabs[0].id, { url });
                }
                await chrome.windows.update(this.keysWindowId, { focused: true });
                return true;
            } catch {
                this.keysWindowId = null;
            }
        }

        // 4. Fallback: open as a compact popup window with extension popup dimensions (375x640)
        const { left, top } = await this.getPopupPosition();
        const created = await chrome.windows.create({
            url,
            type: "popup",
            width: 375,
            height: 640,
            left,
            top,
            focused: true,
        });
        this.keysWindowId = created?.id ?? null;
        return this.keysWindowId != null;
    }

    private async completeKeysOperation(payload: unknown): Promise<void> {
        const stored = await chrome.storage.session.get(PENDING_KEYS_OPERATION_KEY);
        const pending = stored[PENDING_KEYS_OPERATION_KEY] as PendingKeysOperation | undefined;
        if (!pending || pending.expiresAt < Date.now()) {
            await chrome.storage.session.remove(PENDING_KEYS_OPERATION_KEY);
            return;
        }

        const result = this.asRecord(payload);
        const status = this.firstString(result.status);
        const normalizedStatus = ["completed", "cancelled", "failed"].includes(status) ? status : "completed";
        const sanitizedItem = sanitizeSuperappPassword(result.item);
        await chrome.storage.session.remove(PENDING_KEYS_OPERATION_KEY);
        this.broadcastKeysOperation(
            pending,
            normalizedStatus as "completed" | "cancelled" | "failed",
            this.firstString(result.error),
            sanitizedItem ?? undefined
        );

        if (normalizedStatus === "completed" && (pending.action === "create" || pending.action === "delete")) {
            this.broadcastEvent({ type: "ZELF_KEYS_CHANGED" });
        }
        if (pending.uiTabId != null) {
            try {
                await chrome.tabs.remove(pending.uiTabId);
            } catch {
                // The user may already have closed the extension tab.
            }
        }
        if (this.keysWindowId != null) {
            try {
                await chrome.windows.remove(this.keysWindowId);
            } catch {
                // The user or popup may already have closed the window.
            }
            this.keysWindowId = null;
        }
        await this.focusOrigin(pending.origin);
    }

    private async cancelPendingKeysOperation(closedTabId?: number): Promise<void> {
        const stored = await chrome.storage.session.get(PENDING_KEYS_OPERATION_KEY);
        const pending = stored[PENDING_KEYS_OPERATION_KEY] as PendingKeysOperation | undefined;
        if (!pending || (closedTabId != null && pending.uiTabId !== closedTabId)) {
            return;
        }
        await chrome.storage.session.remove(PENDING_KEYS_OPERATION_KEY);
        this.broadcastKeysOperation(pending, "cancelled");
    }

    private async cleanupExpiredKeysOperation(): Promise<void> {
        const stored = await chrome.storage.session.get(PENDING_KEYS_OPERATION_KEY);
        const pending = stored[PENDING_KEYS_OPERATION_KEY] as PendingKeysOperation | undefined;
        if (pending && pending.expiresAt < Date.now()) {
            await chrome.storage.session.remove(PENDING_KEYS_OPERATION_KEY);
        }
    }

    private broadcastKeysOperation(
        pending: PendingKeysOperation,
        status: "opened" | "completed" | "cancelled" | "failed",
        error?: string,
        item?: ZelfKeysPasswordMetadata
    ): void {
        this.broadcastEvent({
            type: "ZELF_KEYS_OPERATION",
            operation: {
                requestId: pending.requestId,
                action: pending.action,
                status,
                ...(error ? { error } : {}),
                ...(item ? { item } : {}),
            },
        });
    }

    private broadcastEvent(event: ZelfBridgeEvent): void {
        for (const port of this.ports) {
            this.postToPort(port, event);
        }
    }

    private async focusOrigin(origin: string): Promise<void> {
        try {
            const tabs = await chrome.tabs.query({ url: `${origin.replace(/\/$/, "")}/*` });
            const tab = tabs[0];
            if (tab?.id == null) {
                return;
            }
            await chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId != null) {
                await chrome.windows.update(tab.windowId, { focused: true });
            }
        } catch (error) {
            Logger.warn("[SuperappHandler] Failed to focus operation origin:", error);
        }
    }

    private async readSession(): Promise<ZelfSession> {
        const items = await chrome.storage.local.get(["wallet", "accessToken", "accessTokenExpiresAt"]);
        const wallet = (items.wallet ?? null) as Record<string, unknown> | null;
        const publicData = this.asRecord(wallet?.publicData);
        const token = typeof items.accessToken === "string" ? items.accessToken : "";
        const expiresAt = typeof items.accessTokenExpiresAt === "number" ? items.accessTokenExpiresAt : 0;
        const tokenValid = Boolean(token && expiresAt && expiresAt > Date.now() / 1000 + 5);
        const tagName = this.firstString(wallet?.tagName, wallet?.name, wallet?.fullTagName, publicData.tagName);
        const domain = this.firstString(publicData.domain) || "zelf";
        const zelfName = tagName ? (tagName.includes(".") ? tagName : `${tagName}.${domain}`) : "";
        const hasWallet = Boolean(zelfName || publicData.ethAddress);
        const needsSetup = !hasWallet;

        return {
            zelfName,
            addresses: this.readAddresses(publicData),
            avatar: this.readAvatar(publicData),
            locked: !tokenValid || !hasWallet,
            needsSetup,
        };
    }

    private async openUnlockUi(sender: chrome.runtime.MessageSender, payload?: unknown): Promise<boolean> {
        try {
            const appName = this.firstString(this.asRecord(payload).appName) || DEFAULT_WEB_APP_NAME;
            const pending: SuperappPendingConnect = {
                origin: sender.origin,
                appName,
                startedAt: Date.now(),
            };

            await chrome.storage.session.set({ [PENDING_CONNECT_KEY]: pending });
            await chrome.storage.local.set({ [PENDING_CONNECT_KEY]: pending });

            const action = this.browserApi.action as { openPopup?: () => Promise<void> } | undefined;
            if (!action?.openPopup) {
                Logger.warn("[SuperappHandler] action.openPopup is not available");
                return true;
            }

            try {
                await action.openPopup();
            } catch (error) {
                Logger.warn("[SuperappHandler] Failed to open toolbar popup; click the Zelf icon to continue:", error);
            }

            return true;
        } catch (error) {
            Logger.error("[SuperappHandler] Failed to open unlock UI:", error);
            return false;
        }
    }

    private async getPopupPosition(): Promise<{ left: number; top: number }> {
        const defaults = { left: 400, top: 80 };

        try {
            const currentWindow = await chrome.windows.getLastFocused();
            if (currentWindow?.width && currentWindow.left !== undefined) {
                return {
                    left: Math.max(0, currentWindow.left + currentWindow.width - 450),
                    top: Math.max(0, currentWindow.top || defaults.top),
                };
            }
        } catch (error) {
            Logger.warn("[SuperappHandler] Failed to get last focused window:", error);
        }

        return defaults;
    }

    private async broadcastSessionChange(): Promise<void> {
        const session = await this.readSession();
        const previous = this.lastSession;
        this.lastSession = session;

        let type: ZelfBridgeEvent["type"] = "ZELF_ACCOUNT_CHANGED";
        if (!previous || previous.locked !== session.locked) {
            type = session.locked ? "ZELF_LOCKED" : "ZELF_UNLOCKED";
        }

        const event: ZelfBridgeEvent = { type, session };
        for (const port of this.ports) {
            this.postToPort(port, event);
        }

        const becameReady = !session.locked && !session.needsSetup && (!previous || previous.locked || previous.needsSetup);
        if (becameReady) {
            await this.focusPendingSuperApp();
        }
    }

    private async focusPendingSuperApp(): Promise<void> {
        const sessionItems = await chrome.storage.session.get(PENDING_CONNECT_KEY);
        const localItems = await chrome.storage.local.get(PENDING_CONNECT_KEY);
        const pending = (sessionItems[PENDING_CONNECT_KEY] || localItems[PENDING_CONNECT_KEY]) as SuperappPendingConnect | undefined;
        if (!pending?.origin) {
            return;
        }

        await chrome.storage.session.remove(PENDING_CONNECT_KEY);
        await chrome.storage.local.remove(PENDING_CONNECT_KEY);

        try {
            const origin = pending.origin.replace(/\/$/, "");
            const tabs = await chrome.tabs.query({ url: `${origin}/*` });
            const tab = tabs[0];
            if (tab?.id == null) {
                return;
            }

            await chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId != null) {
                await chrome.windows.update(tab.windowId, { focused: true });
            }
        } catch (error) {
            Logger.warn("[SuperappHandler] Failed to focus SuperApp tab:", error);
        }
    }

    private startKeepAlive(): void {
        if (this.keepAliveTimer != null) {
            return;
        }

        this.keepAliveTimer = setInterval(() => {
            chrome.runtime.getPlatformInfo(() => undefined);
        }, 20_000);
    }

    private stopKeepAlive(): void {
        if (this.keepAliveTimer == null) {
            return;
        }

        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
    }

    private postToPort(port: chrome.runtime.Port, event: ZelfBridgeEvent): void {
        try {
            port.postMessage(event);
        } catch (error) {
            Logger.warn("[SuperappHandler] Failed to post to SuperApp port:", error);
            this.ports.delete(port);
        }
    }

    private isAllowedOrigin(origin: string | undefined): boolean {
        if (!origin) {
            return false;
        }

        try {
            const url = new URL(origin);
            const host = url.hostname.toLowerCase();

            if (url.protocol === "https:" && (host === "zelf.world" || host.endsWith(".zelf.world"))) {
                return true;
            }

            if (url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1") && url.port === "3001") {
                return true;
            }
        } catch {
            return false;
        }

        return false;
    }

    private readAddresses(publicData: Record<string, unknown>): Record<string, string> {
        const addresses: Record<string, string> = {};

        for (const [chain, key] of ADDRESS_FIELDS) {
            const value = this.firstString(publicData[key]);
            if (value) {
                addresses[chain] = value;
            }
        }

        return addresses;
    }

    private readAvatar(publicData: Record<string, unknown>): string | null {
        const avatar = this.firstString(publicData.avatar, publicData.image);
        if (!avatar) {
            return null;
        }

        if (avatar.startsWith("https://") || avatar.startsWith("http://") || avatar.startsWith("data:image/")) {
            return avatar;
        }

        return null;
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }

        return {};
    }

    private firstString(...values: unknown[]): string {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }

        return "";
    }

    private ok<T>(id: string, result: T): ZelfBridgeResponse<T> {
        return { id, ok: true, result };
    }

    private fail(id: string, code: string, message: string): ZelfBridgeResponse {
        return { id, ok: false, error: { code, message } };
    }
}
