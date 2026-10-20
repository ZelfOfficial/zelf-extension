/**
 * Mirrors `Repositories/Face/modules/face-security.module.js` → `buildIdentifier`.
 */
export function buildFaceIdentifier(body: Record<string, unknown>, extractedDomain?: string): string | null {
    if (body["zelfProof"] != null && String(body["zelfProof"]).trim()) {
        return `zelfProof:${String(body["zelfProof"]).slice(0, 64)}`;
    }

    const domain = body["domain"] ?? extractedDomain ?? "zelf";
    const tagName = body["tagName"] ?? body["newTagName"];
    if (tagName != null && String(tagName).trim() && domain != null) {
        return `${String(tagName).toLowerCase()}@${String(domain).toLowerCase()}`;
    }

    if (body["identifier"] != null && String(body["identifier"]).trim()) {
        const id = String(body["identifier"]).trim();
        if (!isPlaceholderFaceIdentifier(id)) {
            return id;
        }
    }

    if (body["zelfName"] != null) {
        return `${String(body["zelfName"]).toLowerCase()}@${String(domain || "zelf").toLowerCase()}`;
    }

    if (body["id"] != null) {
        return `record:${body["id"]}`;
    }

    if (body["owner"] != null) {
        return `wallet:${String(body["owner"]).toLowerCase()}`;
    }

    return null;
}

export interface FaceIdentifierFallbacks {
    zelfProof?: string | null;
    tagName?: string | null;
    domain?: string | null;
}

export function isPlaceholderFaceIdentifier(identifier: string | null | undefined): boolean {
    if (!identifier?.trim()) return true;
    const id = identifier.trim().toLowerCase();
    return id === "unknown" || id === "session:anonymous";
}

/**
 * Uses wallet/tag fallbacks when the body lacks fields. Never returns placeholder identifiers.
 */
export function resolveFaceIdentifier(body: Record<string, unknown>, fallbacks: FaceIdentifierFallbacks = {}): string | null {
    const fromBody = buildFaceIdentifier(body);
    if (fromBody) {
        return fromBody;
    }

    if (fallbacks.zelfProof?.trim()) {
        return `zelfProof:${fallbacks.zelfProof.slice(0, 64)}`;
    }

    if (fallbacks.tagName?.trim()) {
        const domain = (fallbacks.domain || "zelf").toLowerCase();
        return `${fallbacks.tagName.toLowerCase()}@${domain}`;
    }

    return null;
}
