import { ZelfKeysCardMetadata, ZelfKeysPasswordMetadata } from "../types/superapp.types";

export function sanitizeSuperappPassword(item: unknown): ZelfKeysPasswordMetadata | null {
    const record = asRecord(item);
    const publicData = asRecord(record.publicData);
    const id = firstString(record.id, record.cid);
    if (!id) return null;

    return {
        id,
        alias: firstString(publicData.alias) || null,
        website: firstString(publicData.website),
        username: firstString(publicData.username),
        folder: firstString(publicData.folder) || null,
        createdAt: firstString(record.createdAt, publicData.timestamp) || null,
        updatedAt: firstString(record.updatedAt) || null,
    };
}

export function sanitizeSuperappCard(item: unknown): ZelfKeysCardMetadata | null {
    const record = asRecord(item);
    const publicData = asRecord(record.publicData);
    const id = firstString(record.id, record.cid);
    if (!id) return null;

    const card = parseCard(publicData.card);
    return {
        id,
        alias: firstString(publicData.alias) || null,
        cardName: firstString(card.name, publicData.cardName),
        bankName: firstString(card.bankName, publicData.bankName),
        lastFour: lastFourFrom(card.number),
        expires: firstString(card.expires),
        folder: firstString(publicData.folder) || null,
        createdAt: firstString(record.createdAt, publicData.timestamp) || null,
        updatedAt: firstString(record.updatedAt) || null,
    };
}

function parseCard(value: unknown): Record<string, string> {
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return asStringRecord(parsed);
        } catch {
            return {};
        }
    }
    return asStringRecord(value);
}

function asStringRecord(value: unknown): Record<string, string> {
    const record = asRecord(value);
    return {
        name: firstString(record.name),
        bankName: firstString(record.bankName),
        expires: firstString(record.expires),
        number: firstString(record.number),
    };
}

function lastFourFrom(number: string): string {
    const digits = number.replace(/\D/g, "");
    return digits.slice(-4);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string {
    const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof value === "string" ? value.trim() : "";
}
