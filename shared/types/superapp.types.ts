export const BRIDGE_PROTOCOL_VERSION = 1;

export const BRIDGE_METHODS = [
    "ZELF_HANDSHAKE",
    "ZELF_GET_SESSION",
    "ZELF_REQUEST_UNLOCK",
    "ZELF_KEYS_LIST_PASSWORDS",
    "ZELF_KEYS_OPEN_CREATE_PASSWORD",
    "ZELF_KEYS_OPEN_REVEAL_PASSWORD",
    "ZELF_KEYS_OPEN_DELETE_PASSWORD",
] as const;

export type ZelfBridgeMethod = (typeof BRIDGE_METHODS)[number];

export type ZelfBridgeEventType =
    | "ZELF_LOCKED"
    | "ZELF_UNLOCKED"
    | "ZELF_ACCOUNT_CHANGED"
    | "ZELF_KEYS_CHANGED"
    | "ZELF_KEYS_OPERATION";

export interface ZelfBridgeRequest {
    id: string;
    type: string;
    payload?: unknown;
}

export interface ZelfBridgeError {
    code: string;
    message: string;
}

export interface ZelfBridgeResponse<T = unknown> {
    id: string;
    ok: boolean;
    result?: T;
    error?: ZelfBridgeError;
}

export interface ZelfHandshake {
    protocolVersion: number;
    extensionVersion: string;
    methods: string[];
    capabilities: string[];
}

export interface ZelfSession {
    zelfName: string;
    addresses: Record<string, string>;
    avatar: string | null;
    locked: boolean;
    needsSetup: boolean;
}

export interface ZelfUnlockResult {
    opened: boolean;
}

export interface ZelfKeysPasswordMetadata {
    id: string;
    alias: string | null;
    website: string;
    username: string;
    folder: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface ZelfKeysPasswordList {
    items: ZelfKeysPasswordMetadata[];
    totalCount: number;
}

export type ZelfKeysOperationAction = "create" | "reveal" | "delete";
export type ZelfKeysOperationStatus = "opened" | "completed" | "cancelled" | "failed";

export interface ZelfKeysCreateDraft {
    website: string;
    username: string;
    password: string;
    folder?: string | null;
    appName?: string;
}

export interface ZelfKeysOperationResult {
    requestId: string;
    action: ZelfKeysOperationAction;
    opened: boolean;
}

export interface ZelfKeysOperationEvent {
    requestId: string;
    action: ZelfKeysOperationAction;
    status: ZelfKeysOperationStatus;
    error?: string;
    item?: ZelfKeysPasswordMetadata;
}

export interface ZelfBridgeEvent {
    type: ZelfBridgeEventType;
    session?: ZelfSession;
    operation?: ZelfKeysOperationEvent;
}
