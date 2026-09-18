import "webextension-polyfill";

import { Logger } from "@extension-scripts/logger/logger.class";
import { BrowserApiUtil } from "./services/browser-api-util";
import { MessageHandler } from "./services/message-handler";
import { DappHandler } from "./services/dapp-handler";
import { ExtensionLifecycle } from "./services/extension-lifecycle";
import { SuperappHandler } from "./services/superapp-handler";

const browserApi = new BrowserApiUtil();

const superappHandler = SuperappHandler.getInstance(browserApi);
superappHandler.initialize();

const extensionLifecycle = new ExtensionLifecycle(browserApi);

extensionLifecycle.initialize();

const messageHandler = MessageHandler.getInstance(browserApi);
const dappHandler = DappHandler.getInstance(browserApi);
void dappHandler.restorePendingRequests();

if (!browserApi.has("runtime")) {
    Logger.error("Runtime API not available - extension cannot function");

    throw new Error("Runtime API not available");
}

browserApi.addMessageListener((message, sender, sendResponse) => {
    if (message.type && message.type.startsWith("ZELF_KEYS_OPERATION_")) {
        return false;
    }

    if (message.type && message.type.startsWith("DAPP_")) {
        dappHandler.handleDappMessage(message, sender, sendResponse);
        return true;
    }

    if (message.type && message.type.startsWith("WC_")) {
        return false;
    }

    messageHandler.handleAutofillMessage(message, sender, sendResponse);
    return true;
});
