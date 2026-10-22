/** Canonical native SUI coin type. A spam coin whose symbol is "SUI" is not this type. */
export const NATIVE_SUI_COIN_TYPE = "0x2::sui::SUI";

export interface SuiHoldingLike {
    isNative?: boolean | string | null;
    tokenType?: string | null;
    address_token?: string | null;
    tokenAddress?: string | null;
    symbol?: string | null;
    name?: string | null;
}

export type SuiTransferTarget = { kind: "native" } | { kind: "coin"; coinType: string };

export interface SuiGasSummary {
    computationCost: string;
    storageCost: string;
    storageRebate: string;
}

function canonicalSuiAddress(value: string): string | null {
    const trimmed = value.trim().toLowerCase();

    if (!trimmed.startsWith("0x")) return null;

    const hex = trimmed.slice(2);
    if (!hex || !/^[0-9a-f]+$/.test(hex)) return null;

    return `0x${hex.replace(/^0+/, "") || "0"}`;
}

/** True for `0x2` and `0x2::sui::SUI` (including long-form addresses). Symbol "SUI" is not enough. */
export function isNativeSuiCoinType(value: string | null | undefined): boolean {
    const raw = `${value || ""}`.trim();
    if (!raw) return false;

    const lower = raw.toLowerCase();
    if (!lower.includes("::")) return canonicalSuiAddress(lower) === "0x2";

    const [address, moduleName, structName] = lower.split("::");

    return canonicalSuiAddress(address) === "0x2" && moduleName === "sui" && structName === "sui" && lower.split("::").length === 3;
}

/**
 * Native SUI is `isNative`, tokenType `SUI`, or coin type `0x2::sui::SUI`.
 * A spam coin that only shares the symbol "SUI" is not native.
 */
export function isNativeSuiHolding(token: SuiHoldingLike | null | undefined): boolean {
    if (!token) return false;
    if (token.isNative === true || token.isNative === "true") return true;
    if (token.isNative === false || token.isNative === "false") return false;
    if (`${token.tokenType || ""}`.trim() === "SUI") return true;

    return isNativeSuiCoinType(token.tokenType) || isNativeSuiCoinType(token.address_token) || isNativeSuiCoinType(token.tokenAddress);
}

/**
 * Coin type used when spending a non-native SUI coin.
 * Full coin types (`0x…::module::STRUCT`) are used as-is. Legacy package ids still get `::coin::COIN`.
 * Native SUI (`0x2` / `0x2::sui::SUI`) is not a token coin type.
 */
export function resolveSuiTransferTarget(addressToken: string | null | undefined): SuiTransferTarget {
    const raw = `${addressToken || ""}`.trim();
    if (!raw || isNativeSuiCoinType(raw)) return { kind: "native" };
    if (raw.includes("::")) return { kind: "coin", coinType: raw };

    return { kind: "coin", coinType: `${raw}::coin::COIN` };
}

/** Send-screen token types that belong to the Sui address (native, SUI_TOKEN, or a Move coin type). */
export function isSuiSendTokenType(tokenType: string | null | undefined): boolean {
    const type = `${tokenType || ""}`.trim();

    return type === "SUI" || type === "SUI_TOKEN" || type.includes("::");
}

/** A coin type (`::`) is sent as SUI_TOKEN. Native `SUI` stays `SUI`. */
export function sendScreenSuiTokenType(tokenType: string | null | undefined): string {
    const type = `${tokenType || ""}`.trim();

    return type.includes("::") ? "SUI_TOKEN" : type;
}

export function formatMistAsSui(mist: bigint): string {
    const negative = mist < 0n;
    const abs = negative ? -mist : mist;
    const whole = abs / 1_000_000_000n;
    const frac = (abs % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    const text = frac ? `${whole}.${frac}` : `${whole.toString()}`;

    return negative ? `-${text}` : text;
}

/** Floor a decimal amount into MIST. Extra fraction digits are dropped, never rounded. */
export function decimalToMist(amount: string | number, decimals = 9): bigint {
    const text = String(amount).replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return 0n;

    const [whole, frac = ""] = text.split(".");
    const digits = (frac + "0".repeat(decimals)).slice(0, decimals);

    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(digits || "0");
}

/** Net SUI burned by a dry-run (computation + storage - rebate). */
export function netSuiFeeMist(gas: SuiGasSummary): bigint {
    const computation = BigInt(gas.computationCost || "0");
    const storage = BigInt(gas.storageCost || "0");
    const rebate = BigInt(gas.storageRebate || "0");
    const net = computation + storage - rebate;

    return net > 0n ? net : 0n;
}

/**
 * Whole-balance send when the user chose Max/ALL, or the typed amount is already
 * at least what a gas-coin transfer would deliver (balance minus the net fee).
 */
export function shouldSendEntireSuiBalance(amountMist: bigint, deliveredMist: bigint, sendAll: boolean): boolean {
    if (sendAll) return deliveredMist > 0n;
    if (deliveredMist <= 0n) return false;

    return amountMist >= deliveredMist;
}

/** Headroom covering an exact `coinWithBalance` gas budget (about 1.188M MIST on mainnet). */
export const SUI_EXACT_GAS_BUDGET_CEILING_MIST = 2_000_000n;

/** Floor MIST to the 4-decimal amount shown on the confirm screen (drops 100_000 MIST units). */
export function floorDisplayMist(mist: bigint, coinDecimals = 9, displayDecimals = 4): bigint {
    if (mist <= 0n) return 0n;

    const drop = BigInt(Math.max(0, coinDecimals - displayDecimals));
    const factor = 10n ** drop;

    return (mist / factor) * factor;
}

/** True when the typed amount is the floored Max value, or higher, once 4-decimal display is applied. */
export function typedAmountMatchesDisplayedMax(amountMist: bigint, deliveredMist: bigint): boolean {
    if (amountMist <= 0n || deliveredMist <= 0n) return false;

    return floorDisplayMist(amountMist) >= floorDisplayMist(deliveredMist);
}

export function isInsufficientCoinBalanceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

    return /insufficient coin balance/i.test(message);
}

/** Exact sends must leave the gas budget, not only the net fee, in the balance. */
export function suiAmountFitsGasBudget(amountMist: bigint, balanceMist: bigint, gasBudgetMist: bigint): boolean {
    return amountMist + gasBudgetMist <= balanceMist;
}

export function insufficientSuiMessage(availableMist: bigint, requestedMist: bigint): string {
    return `Not enough SUI. Available ${formatMistAsSui(availableMist)} SUI, requested ${formatMistAsSui(requestedMist)} SUI. The network fee is paid from this balance.`;
}

export function suiGasReserveMessage(availableMist: bigint): string {
    return `Not enough SUI left for the network fee. Available ${formatMistAsSui(availableMist)} SUI. Leave enough SUI to pay gas, or send a smaller amount.`;
}

/** Network row on confirm. Sui coin types and SUI_TOKEN display as Sui. */
export function sendConfirmNetworkLabel(network: string | null | undefined, tokenType: string | null | undefined): string {
    if ((network || "").toLowerCase() === "sui") return "Sui";

    return tokenType || "";
}

/** Gas budget (MIST) from a dry-run, with headroom so execution is not short. */
export function mistGasBudget(gas: SuiGasSummary): bigint {
    const computation = BigInt(gas.computationCost || "0");
    const storage = BigInt(gas.storageCost || "0");
    const rebate = BigInt(gas.storageRebate || "0");
    const net = computation + storage > rebate ? computation + storage - rebate : 0n;
    const buffered = net + net / 5n + 1000n;
    const ceiling = computation + storage + 1000n;

    return buffered > ceiling ? buffered : ceiling;
}

/**
 * GraphQL URL from a domain-license network entry (`tags.wallet.networks.sui`), when the admin set one.
 * A retired JSON-RPC fullnode URL is ignored.
 */
export function suiGraphqlUrlFromLicenseNetwork(entry: unknown): string | null {
    if (!entry || typeof entry !== "object") return null;

    const record = entry as Record<string, unknown>;

    for (const key of ["graphql", "graphqlUrl"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    for (const key of ["url", "rpc", "rpcUrl"]) {
        const value = record[key];
        if (typeof value === "string" && value.toLowerCase().includes("graphql")) return value.trim();
    }

    return null;
}

export function suiNetworkFromGraphqlUrl(url: string): "mainnet" | "testnet" | "devnet" {
    const lower = url.toLowerCase();
    if (lower.includes("devnet")) return "devnet";
    if (lower.includes("testnet")) return "testnet";

    return "mainnet";
}
