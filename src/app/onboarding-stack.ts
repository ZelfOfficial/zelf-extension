export type OnboardingSearchData = {
    available?: boolean;
    tagObject?: {
        publicData?: { v?: unknown; tagName?: string; domain?: string };
        zelfProof?: string;
        name?: string;
    };
    zelfIDObject?: {
        publicData?: { v?: unknown; tagName?: string; domain?: string };
        zelfProof?: string;
        name?: string;
    };
};

export type ProofPreview = {
    passwordLayer?: string;
    publicData?: { st?: string; hasPassword?: string };
    st?: string;
};

export type PreviewTagModel = {
    updatePublicData(data: { st?: string; hasPassword?: string }): void;
};

/** `undefined` means unknown — unlock should ask for a password. */
export function proofRequiresPassword(layer?: string, hasPassword?: string): boolean | undefined {
    if (layer === "WithPassword" || layer === "Password") return true;
    if (layer === "WithoutPassword" || layer === "NoPassword") return false;
    if (hasPassword === "true") return true;
    if (hasPassword === "false") return false;

    return undefined;
}

export function hasPasswordFromPreview(preview?: ProofPreview | null): string {
    if (!preview) return "";

    const required = proofRequiresPassword(preview.passwordLayer, preview.publicData?.hasPassword);

    if (required === true) return "true";
    if (required === false) return "false";

    return "";
}

export function applyPreviewSecurity(tagModel: PreviewTagModel, preview?: ProofPreview | null): void {
    if (!preview) return;

    const st = preview.publicData?.st || preview.st;
    const hasPassword = hasPasswordFromPreview(preview);

    if (!st && !hasPassword) return;

    tagModel.updatePublicData({
        ...(st ? { st } : {}),
        ...(hasPassword ? { hasPassword } : {}),
    });
}

function unwrapPreviewResponse(response: unknown): ProofPreview | null {
    if (!response || typeof response !== "object") return null;

    const payload = response as { data?: { preview?: ProofPreview } & ProofPreview; preview?: ProofPreview };
    const preview = payload.data?.preview || payload.preview || payload.data;

    if (!preview || typeof preview !== "object") return null;

    return preview;
}

export async function previewProofSecurity(
    zelfProof: string,
    previewV4: (proof: string) => Promise<unknown>,
    previewLegacy: (proof: string) => Promise<unknown>
): Promise<ProofPreview | null> {
    if (!zelfProof) return null;

    let v4Preview: ProofPreview | null = null;

    try {
        v4Preview = unwrapPreviewResponse(await previewV4(zelfProof));

        if (v4Preview?.passwordLayer) return v4Preview;
    } catch {
        // v4 preview often fails on pre-merge 3.1.6 proofs
    }

    try {
        const legacyPreview = unwrapPreviewResponse(await previewLegacy(zelfProof));

        if (legacyPreview) return legacyPreview;
    } catch {
        // keep v4 payload if it had publicData but no passwordLayer
    }

    return v4Preview;
}

export type OnboardingRecordService = {
    createTagModelFromSearchResponse(data: any): any;
    setTagName(name: string, price?: any): Promise<void>;
    setZelfProof(proof: string): Promise<void>;
    setDomain(domain: string): Promise<void>;
    setTagNameObject(obj: any): Promise<void>;
    setTagResponse(data: any): Promise<void>;
    setFlow(flow: any): Promise<void>;
};

export function isV4Record(data?: OnboardingSearchData | null): boolean {
    if (!data || data.available) return false;

    const record = data.tagObject || data.zelfIDObject;
    const v = record?.publicData?.v;

    return v === 4 || v === "4";
}

export async function seedTakenOnboardingRecord(service: OnboardingRecordService, responseData: any): Promise<boolean> {
    const tagModel = service.createTagModelFromSearchResponse(responseData);

    if (!tagModel) return false;

    const tagName = tagModel.publicData?.tagName || tagModel.name;

    if (tagName) {
        await service.setTagName(String(tagName).toLowerCase(), responseData);
        await service.setZelfProof(tagModel.zelfProof || "");
        await service.setDomain(tagModel.publicData?.domain || "zelf");
        await service.setTagNameObject(tagModel);
        await service.setTagResponse(responseData);
    }

    await service.setFlow("unlock");

    return true;
}
