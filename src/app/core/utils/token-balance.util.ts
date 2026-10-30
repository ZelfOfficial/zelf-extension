import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";

const AMOUNT_FIELDS = ["amount", "_amount", "balance", "_balance"] as const;
const FIAT_FIELDS = ["fiatBalance", "_fiatBalance"] as const;

function readFinite(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;

    const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, "").trim());

    return Number.isFinite(n) ? n : null;
}

/** First non-zero reported amount, or 0 when a field was present and zero, or null when the row has no amount. */
export function readReportedAmount(token: any): number | null {
    let sawZero = false;

    for (const field of AMOUNT_FIELDS) {
        const n = readFinite(token?.[field]);

        if (n === null) continue;
        if (n !== 0) return n;

        sawZero = true;
    }

    return sawZero ? 0 : null;
}

/** Reported fiat, or null when the row did not include one. Zero is a real report. */
export function readReportedFiat(token: any): number | null {
    for (const field of FIAT_FIELDS) {
        const n = readFinite(token?.[field]);

        if (n !== null) return n;
    }

    return null;
}

export function readPrice(value: unknown): number | null {
    return readFinite(value);
}

/** True when the row carries an amount or fiat the chain actually reported (including a real 0). */
export function hasReportedBalance(token: any): boolean {
    return readReportedAmount(token) !== null || readReportedFiat(token) !== null;
}

/**
 * Fiat to show and sum. A missing or zero fiat with a real amount uses amount × price.
 * A reported 0 amount stays 0.
 */
export function resolveTokenFiat(token: any, amount: number | null, price: number | null): number | null {
    const reported = readReportedFiat(token);

    if (reported !== null && reported !== 0) return reported;

    if (amount && price) {
        const computed = amount * price;

        if (Number.isFinite(computed) && computed !== 0) return computed;
    }

    return reported;
}

/**
 * Tickers that mean the chain's native asset, including renames.
 * Polygon's API still types the native coin as MATIC after the POL rebrand.
 * OP and ARB are governance tokens, not the ETH native asset on those chains.
 */
const NATIVE_SYMBOL_ALIASES: Record<string, readonly string[]> = {
    ethereum: ["ETH", "ETHEREUM", "ETHER"],
    optimism: ["ETH", "ETHEREUM", "ETHER"],
    arbitrum: ["ETH", "ETHEREUM", "ETHER"],
    base: ["ETH", "ETHEREUM", "ETHER"],
    polygon: ["POL", "MATIC", "POLYGON"],
    binance: ["BNB", "BINANCE", "BSC"],
    avalanche: ["AVAX", "AVALANCHE"],
    solana: ["SOL", "SOLANA"],
    bitcoin: ["BTC", "BITCOIN"],
    sui: ["SUI"],
    ton: ["TON", "TONCOIN"],
    aptos: ["APT", "APTOS", "APTOS COIN"],
    stellar: ["XLM", "STELLAR"],
    polkadot: ["DOT", "POLKADOT"],
    kusama: ["KSM", "KUSAMA"],
    blockdag: ["BDAG", "BLOCKDAG"],
};

export function nativeSymbolAliases(chainId: string | null | undefined): readonly string[] {
    const id = tokenNetworkToLicenseId(chainId);

    if (NATIVE_SYMBOL_ALIASES[id]) return NATIVE_SYMBOL_ALIASES[id];

    const config = DEFAULT_NETWORK_CONFIGS.find((network) => network.id === id);

    return config ? [config.symbol.toUpperCase(), config.name.toUpperCase()] : [];
}

/** Catalog symbol for the chain (`POL` for Polygon), used so MATIC and POL share one card. */
export function canonicalNativeSymbol(chainId: string | null | undefined): string {
    const id = tokenNetworkToLicenseId(chainId);
    const config = DEFAULT_NETWORK_CONFIGS.find((network) => network.id === id);

    return (config?.symbol || nativeSymbolAliases(id)[0] || "").toUpperCase();
}

export function isNativeChainToken(token: { symbol?: string; name?: string; tokenType?: string; network?: string } | null | undefined): boolean {
    const aliases = new Set(nativeSymbolAliases(token?.network));

    if (!aliases.size) return false;

    const symbol = (token?.symbol || "").toString().trim().toUpperCase();
    const name = (token?.name || "").toString().trim().toUpperCase();
    const type = (token?.tokenType || "").toString().trim().toUpperCase();
    const typeIsNative = !type || aliases.has(type);
    const labelIsNative = aliases.has(symbol) || aliases.has(name);

    return typeIsNative && labelIsNative;
}

/**
 * L2 address payloads sometimes put the native balance on the envelope (`data.balance`) and a
 * priced token row whose amount is 0 or missing. Copy a positive envelope balance onto that
 * native row, or create the row when the token list was empty.
 */
export function applyEnvelopeNativeBalance<T extends Record<string, any>>(tokens: ReadonlyArray<T> | null | undefined, networkLabel: string, envelope: any): T[] {
    const list = [...(tokens || [])];
    const envelopeAmount = readReportedAmount({ amount: envelope?.balance ?? envelope?._balance });

    if (envelopeAmount == null) return list;

    const chainId = tokenNetworkToLicenseId(networkLabel);
    const index = list.findIndex((token) => tokenNetworkToLicenseId(token?.network) === chainId && isNativeChainToken(token));
    const envelopePrice = readPrice(envelope?.account?.price ?? envelope?.price);
    const envelopeFiat = readReportedFiat(envelope);

    // A reported 0 with no native row should still render as 0. Never wipe a balance we already have.
    if (envelopeAmount === 0) {
        if (index !== -1) return list;

        list.push(nativeRowFromEnvelope(chainId, networkLabel, 0, envelopePrice, envelopeFiat) as unknown as T);

        return list;
    }

    if (index === -1) {
        list.push(nativeRowFromEnvelope(chainId, networkLabel, envelopeAmount, envelopePrice, envelopeFiat) as unknown as T);

        return list;
    }

    const current = list[index];
    const currentAmount = readReportedAmount(current);

    if (currentAmount != null && currentAmount !== 0) return list;

    const price = readPrice(current?.price) || envelopePrice || 0;
    const fiat = envelopeFiat && envelopeFiat !== 0 ? envelopeFiat : price ? envelopeAmount * price : (readReportedFiat(current) ?? 0);

    list[index] = {
        ...current,
        amount: envelopeAmount,
        balance: envelopeAmount,
        price: price || current?.price,
        fiatBalance: fiat,
    };

    return list;
}

function nativeRowFromEnvelope(
    chainId: string,
    networkLabel: string,
    amount: number,
    price: number | null,
    fiat: number | null
): Record<string, unknown> {
    const config = DEFAULT_NETWORK_CONFIGS.find((network) => network.id === chainId);
    const symbol = config?.symbol || networkLabel;
    const name = config?.name || networkLabel;
    const resolvedFiat = fiat && fiat !== 0 ? fiat : price && amount ? amount * price : 0;

    return {
        symbol,
        name,
        network: name,
        tokenType: symbol,
        amount,
        balance: amount,
        price: price ?? 0,
        fiatBalance: resolvedFiat,
    };
}

const RESPONSE_NETWORKS: ReadonlyArray<{ key: string; label: string }> = [
    { key: "ethereum", label: "Ethereum" },
    { key: "solana", label: "Solana" },
    { key: "avalanche", label: "Avalanche" },
    { key: "binance", label: "Binance" },
    { key: "blockdag", label: "BlockDAG" },
    { key: "polygon", label: "Polygon" },
    { key: "optimism", label: "Optimism" },
    { key: "arbitrum", label: "Arbitrum" },
    { key: "base", label: "Base" },
    { key: "sui", label: "Sui" },
    { key: "ton", label: "Ton" },
    { key: "aptos", label: "Aptos" },
    { key: "polkadot", label: "Polkadot" },
    { key: "kusama", label: "Kusama" },
    { key: "stellar", label: "Stellar" },
    { key: "bitcoin", label: "Bitcoin" },
];

/** Apply each chain envelope's native balance onto the tokens parsed from that response. */
export function applyResponseEnvelopes<T extends Record<string, any>>(tokens: ReadonlyArray<T> | null | undefined, response: any): T[] {
    let next = [...(tokens || [])];

    if (!response || typeof response !== "object") return next;

    for (const { key, label } of RESPONSE_NETWORKS) {
        const envelope = response?.[key]?.data;

        if (envelope) next = applyEnvelopeNativeBalance(next, label, envelope);
    }

    return next;
}
