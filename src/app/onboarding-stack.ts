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
