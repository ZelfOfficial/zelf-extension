import { ZelfKeysPasswordMetadata } from "../types/superapp.types";

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

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string {
    const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof value === "string" ? value.trim() : "";
}
