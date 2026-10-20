/**
 * Mirrors `Repositories/Face/modules/face-security.module.js` → `buildIdentifier`.
 */
export function buildFaceIdentifier(body: Record<string, unknown>, extractedDomain?: string): string {
    if (body["zelfProof"] != null && String(body["zelfProof"]).trim()) {
        return `zelfProof:${String(body["zelfProof"]).slice(0, 64)}`;
    }

    const domain = body["domain"] ?? extractedDomain ?? "zelf";
    const tagName = body["tagName"] ?? body["newTagName"];
    if (tagName != null && domain != null) {
        return `${String(tagName).toLowerCase()}@${String(domain).toLowerCase()}`;
    }

    if (body["identifier"] != null) {
        return String(body["identifier"]);
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

    return "unknown";
}
