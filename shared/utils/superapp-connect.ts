export const DEFAULT_WEB_APP_NAME = "Zelf SuperApp";
export const PENDING_CONNECT_KEY = "superapp_pending_connect";

export interface SuperappPendingConnect {
    origin?: string;
    appName: string;
    startedAt: number;
}
