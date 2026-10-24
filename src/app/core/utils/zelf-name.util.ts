/**
 * One Zelf name for sessions and face checks.
 * Trim, lowercase, strip a repeated `.{domain}`, then append that domain once.
 * `JimBot`, `Jimbot.Zelf`, and `Jimbot.Zelf.zelf` with domain `zelf` are all `jimbot.zelf`.
 */
export function normalizeZelfName(
    tagName: string | null | undefined,
    domain = "zelf"
): { tagName: string; domain: string; zelfName: string } {
    const tld = String(domain || "zelf")
        .trim()
        .toLowerCase()
        .replace(/^\.+/, "");
    let bare = String(tagName || "")
        .trim()
        .toLowerCase();

    if (!bare || !tld) {
        return { tagName: "", domain: tld, zelfName: "" };
    }

    const suffix = `.${tld}`;

    while (bare.endsWith(suffix)) {
        bare = bare.slice(0, -suffix.length);
    }

    bare = bare.replace(/\.+$/, "");

    if (!bare) {
        return { tagName: "", domain: tld, zelfName: "" };
    }

    return {
        tagName: bare,
        domain: tld,
        zelfName: `${bare}.${tld}`,
    };
}

/** Copy a request so `tagName` is the normalized `name.domain` we send to the API. */
export function withNormalizedZelfTag<T extends object>(request: T): T {
    const record = request as T & { tagName?: string | null; domain?: string | null };

    if (!record.tagName) return request;

    const normalized = normalizeZelfName(record.tagName, record.domain || "zelf");

    if (!normalized.zelfName) return request;

    return {
        ...record,
        tagName: normalized.zelfName,
        ...(record.domain ? { domain: normalized.domain } : {}),
    };
}
