import { Injectable } from "@angular/core";

import { DomainLicense } from "app/core/models/domain.type";
import { environment } from "../environments/environment";
import { ChromeService } from "./chrome.service";
import { HttpWrapperService } from "./http-wrapper.service";
import {
    DomainConfiguration,
    OperatingSystem,
    TagDecryptRequest,
    TagFlow,
    TagLeaseRecoveryRequest,
    TagLeaseRequest,
    TagModel,
    TagOfflineLeaseRequest,
    TagPreviewRequest,
    TagPreviewZelfIdQrRequest,
    TagSearchRequest,
    TagSearchResponse,
    TagType,
    ZelfProofPreviewRequest,
} from "./tags.service";
import { VaultService } from "./vault.service";

export type ZelfIdPlan = "free" | "premium" | "unlimited" | "";

export interface ZelfIdPrice {
    price?: number;
    currency?: string;
    reward?: number;
    discount?: number;
    priceWithoutDiscount?: number;
    discountType?: string;
    plan?: ZelfIdPlan;
    allowedPlans?: ZelfIdPlan[];
}

export interface ZelfIdSearchResponse extends TagSearchResponse {
    price?: ZelfIdPrice;
    preview?: unknown;
    zelfIDObject?: TagSearchResponse["tagObject"];
}

export { TagFlow, TagModel, TagSearchResponse, TagType };
export type { OperatingSystem };

const CHROME_KEYS = {
    name: "zelfIdName",
    object: "zelfIdObject",
    response: "zelfIdResponse",
    newName: "newZelfIdName",
    domain: "zelfIdDomain",
    flow: "zelfIdFlow",
    proof: "zelfIdProof",
    referral: "zelfIdReferral",
    mnemonicCount: "zelfIdMnemonicCount",
    price: "zelfIdPrice",
    reward: "zelfIdReward",
    duration: "zelfIdDuration",
} as const;

const DOMAIN_CACHE_KEYS = {
    timestamp: "zelfIdDomainCacheTimestamp",
    keys: "zelfIdDomainKeys",
    configPrefix: "zelfIdDomainConfig_",
} as const;

@Injectable({
    providedIn: "root",
})
export class ZelfIdsService {
    readonly baseUrl = environment.v4ApiUrl;
    readonly apiPath = `${this.baseUrl}/api/zelf-ids`;

    private _variables: Record<string, unknown> = {};
    private _activeDomainKeys?: Set<string>;
    private _activeDomainsPromise: Promise<Set<string>> | null = null;
    private _domainKeys: string[] = [];
    private _domainConfigs: { [domainName: string]: DomainLicense } = {};

    constructor(
        private _httpWrapper: HttpWrapperService,
        private _chromeService: ChromeService,
        private _vaultService: VaultService
    ) {}

    get domainConfigs(): { [domainName: string]: DomainLicense } {
        return this._domainConfigs;
    }

    get domainKeys(): string[] {
        return this._domainKeys;
    }

    async cleanOnboardingState(): Promise<void> {
        await Promise.all(Object.values(CHROME_KEYS).map((key) => this._chromeService.removeItem(key)));
        this._variables = {};
    }

    getDomains(): Promise<{ data: Record<string, DomainLicense> }> {
        return this._httpWrapper.sendRequest("get", `${this.apiPath}/domains`, {
            includeNonPaid: environment.includeNonPaidDomains,
        });
    }

    getDomainByName(domain: string): Promise<{ data: DomainLicense }> {
        return this._httpWrapper.sendRequest("get", `${this.apiPath}/domains/${domain}`);
    }

    getDomainLicense(domainName: string): DomainLicense | undefined {
        return this._domainConfigs[domainName];
    }

    async loadDomains(): Promise<DomainLicense[]> {
        try {
            const response = await this.getDomains();

            if (response.data) {
                this._domainKeys = Object.keys(response.data);
                this._domainConfigs = response.data;
                await this._saveDomainsToStorage();
            }
        } catch {
            // Fall back to cached storage if API fails
        }

        return this.loadDomainsFromStorage();
    }

    async loadDomainsFromStorage(): Promise<DomainLicense[]> {
        try {
            const keysData = await this._chromeService.getItem<string[]>(DOMAIN_CACHE_KEYS.keys);

            if (keysData) this._domainKeys = Array.isArray(keysData) ? keysData : JSON.parse(keysData as unknown as string);

            this._domainConfigs = {};

            for (const domainName of this._domainKeys) {
                const config = await this._chromeService.getItem<DomainLicense>(`${DOMAIN_CACHE_KEYS.configPrefix}${domainName}`);

                if (config) this._domainConfigs[domainName] = config;
            }

            return Object.values(this._domainConfigs);
        } catch {
            return [];
        }
    }

    private async _saveDomainsToStorage(): Promise<void> {
        await this._chromeService.setItem(DOMAIN_CACHE_KEYS.timestamp, Date.now().toString());
        await this._chromeService.setItem(DOMAIN_CACHE_KEYS.keys, this._domainKeys);

        for (const [domainName, config] of Object.entries(this._domainConfigs)) {
            await this._chromeService.setItem(`${DOMAIN_CACHE_KEYS.configPrefix}${domainName}`, config);
        }
    }

    private async resolveDomainForSearch(domain: string | undefined): Promise<string | undefined> {
        if (!domain) return domain;

        const keys = await this.loadActiveDomainKeys();

        if (keys.size === 0) return domain;

        const normalized = domain.toLowerCase();

        return keys.has(normalized) ? normalized : "zelf";
    }

    private loadActiveDomainKeys(): Promise<Set<string>> {
        if (this._activeDomainsPromise) return this._activeDomainsPromise;
        if (this._activeDomainKeys !== undefined) return Promise.resolve(this._activeDomainKeys);

        this._activeDomainsPromise = (async () => {
            try {
                const res = await this.getDomains();
                const data = res?.data ?? {};
                const keys = new Set<string>();

                for (const name of Object.keys(data)) {
                    const cfg = data[name] as DomainLicense | DomainConfiguration;

                    if ((cfg as DomainLicense)?.status === "active") keys.add(name.toLowerCase());
                }

                this._activeDomainKeys = keys;
                return keys;
            } catch {
                this._activeDomainKeys = new Set();
                return this._activeDomainKeys;
            } finally {
                this._activeDomainsPromise = null;
            }
        })();

        return this._activeDomainsPromise;
    }

    async searchTag(request: TagSearchRequest): Promise<{ data: ZelfIdSearchResponse }> {
        const query: Record<string, string> = {};
        let domain = request.domain;

        if (request.tagName && domain) {
            domain = await this.resolveDomainForSearch(domain);
        }

        if (request.tagName) query.tagName = request.tagName;
        if (domain) query.domain = domain;
        if (request.key) query.key = request.key;
        if (request.value) query.value = request.value;
        if (request.os) query.os = request.os;
        if (request.captchaToken) query.captchaToken = request.captchaToken;

        return this._httpWrapper.sendRequest("get", `${this.apiPath}/search`, query);
    }

    async previewTag(request: TagPreviewRequest): Promise<{ data: ZelfIdSearchResponse }> {
        const query: Record<string, string> = { os: request.os || "DESKTOP" };
        let domain = request.domain;

        if (request.tagName && domain) {
            domain = await this.resolveDomainForSearch(domain);
        }

        if (request.tagName) query.tagName = request.tagName;
        if (domain) query.domain = domain;
        if (request.captchaToken) query.captchaToken = request.captchaToken;

        return this._httpWrapper.sendRequest("get", `${this.apiPath}/preview`, query);
    }

    leaseTag(request: TagLeaseRequest): Promise<any> {
        const promise = this._httpWrapper.sendRequest("post", `${this.apiPath}/lease`, request);

        promise.then(() => this._vaultService.setLastVerified());

        return promise;
    }

    leaseRecovery(request: TagLeaseRecoveryRequest): Promise<any> {
        const { newTagName, ...rest } = request;
        const body = {
            ...rest,
            tagName: newTagName,
        };

        const promise = this._httpWrapper.sendRequest("post", `${this.apiPath}/lease-recovery`, body);

        promise.then(() => this._vaultService.setLastVerified());

        return promise;
    }

    leaseOfflineTag(request: TagOfflineLeaseRequest): Promise<any> {
        const promise = this._httpWrapper.sendRequest("post", `${this.apiPath}/lease-offline`, request).then((response) => {
            if (response?.data?.zelfIDObject && !response.data.tagObject) {
                response.data.tagObject = response.data.zelfIDObject;
            }

            return response;
        });

        promise.then(() => this._vaultService.setLastVerified());

        return promise;
    }

    decryptTag(request: TagDecryptRequest): Promise<any> {
        const promise = this._httpWrapper.sendRequest("post", `${this.apiPath}/decrypt`, request);

        promise.then(() => this._vaultService.setLastVerified());

        return promise;
    }

    previewZelfProof(request: ZelfProofPreviewRequest): Promise<any> {
        return this._httpWrapper.sendRequest("post", `${this.apiPath}/preview-zelfproof`, request);
    }

    previewZelfIdQr(request: TagPreviewZelfIdQrRequest): Promise<any> {
        return this._httpWrapper.sendRequest("post", `${this.apiPath}/preview-zelf-id-qr`, request);
    }

    createTagModelFromSearchResponse(response: TagSearchResponse | ZelfIdSearchResponse): TagModel | null {
        const record = response.tagObject || (response as ZelfIdSearchResponse).zelfIDObject;

        if (!record) return null;

        const tagModel = new TagModel(record);
        const preview = (response as ZelfIdSearchResponse).preview as { publicData?: { st?: string; hasPassword?: string }; passwordLayer?: string } | undefined;

        this._mergePreviewSecurity(tagModel, preview);

        return tagModel;
    }

    private _mergePreviewSecurity(
        tagModel: TagModel,
        preview?: { publicData?: { st?: string; hasPassword?: string }; passwordLayer?: string; st?: string } | null
    ): void {
        if (!preview) return;

        const st = preview.publicData?.st || preview.st;
        const hasPassword =
            preview.publicData?.hasPassword ||
            (preview.passwordLayer ? `${Boolean(preview.passwordLayer === "WithPassword")}` : "");

        if (!st && !hasPassword) return;

        tagModel.updatePublicData({
            ...(st ? { st } : {}),
            ...(hasPassword ? { hasPassword } : {}),
        });
    }

    resolvePlanHint(response?: ZelfIdSearchResponse | null, tagName?: string): { plan: ZelfIdPlan; allowedPlans: ZelfIdPlan[]; isShortName: boolean } {
        const name = (tagName || response?.tagName || "").split(".")[0];
        const isShortName = name.length > 0 && name.length <= 5;
        const price = response?.price;

        if (price?.plan || price?.allowedPlans?.length) {
            return {
                plan: (price.plan || (isShortName ? "unlimited" : "free")) as ZelfIdPlan,
                allowedPlans: (price.allowedPlans || (isShortName ? ["unlimited"] : ["free", "premium", "unlimited"])) as ZelfIdPlan[],
                isShortName,
            };
        }

        return {
            plan: isShortName ? "unlimited" : "free",
            allowedPlans: isShortName ? ["unlimited"] : ["free", "premium", "unlimited"],
            isShortName,
        };
    }

    async setTagName(tagName: string, priceObject: any = {}): Promise<void> {
        if (!tagName) return;

        const sanitizedTagName = tagName.split(".")[0];

        this._variables.name = sanitizedTagName;

        const setPromise = sanitizedTagName
            ? this._chromeService.setItem(CHROME_KEYS.name, sanitizedTagName)
            : this._chromeService.removeItem(CHROME_KEYS.name);

        setPromise.then(() => {
            if (!priceObject) return;

            this._variables.price = priceObject.price;
            this._variables.reward = priceObject.reward;

            this._chromeService.setItem(CHROME_KEYS.price, priceObject.price);
            this._chromeService.setItem(CHROME_KEYS.reward, priceObject.reward);
        });
    }

    async setTagNameObject(tagNameObject: any): Promise<void> {
        this._variables.object = tagNameObject;
        await this._chromeService.setItem(CHROME_KEYS.object, tagNameObject);
    }

    async setTagResponse(tagResponse: TagSearchResponse | ZelfIdSearchResponse): Promise<void> {
        this._variables.response = tagResponse;
        await this._chromeService.setItem(CHROME_KEYS.response, tagResponse);
    }

    async setNewTagName(newTagName: string): Promise<void> {
        this._variables.newName = newTagName;
        await this._chromeService.setItem(CHROME_KEYS.newName, newTagName);
    }

    async setMnemonicCount(value: 12 | 24 | 0): Promise<void> {
        this._variables.mnemonicCount = value;
        await this._chromeService.setItem(CHROME_KEYS.mnemonicCount, value);
    }

    async setFlow(flow: TagFlow): Promise<void> {
        this._variables.flow = flow;
        await this._chromeService.setItem(CHROME_KEYS.flow, flow);
    }

    async setZelfProof(zelfProof: string): Promise<void> {
        this._variables.proof = zelfProof;
        await this._chromeService.setItem(CHROME_KEYS.proof, zelfProof);
    }

    async setDuration(duration: any): Promise<void> {
        this._variables.duration = duration;
        await this._chromeService.setItem(CHROME_KEYS.duration, duration);
    }

    async setReferral(referralTagName: string): Promise<void> {
        this._variables.referral = referralTagName;
        await this._chromeService.setItem(CHROME_KEYS.referral, referralTagName);
    }

    async setDomain(domain: string): Promise<void> {
        this._variables.domain = domain;
        await this._chromeService.setItem(CHROME_KEYS.domain, domain);
    }

    async getMnemonicCount(): Promise<12 | 24 | 0> {
        return (this._variables.mnemonicCount as 12 | 24 | 0) || (await this._chromeService.getItem(CHROME_KEYS.mnemonicCount));
    }

    async getTagNameObject(): Promise<any> {
        return this._variables.object || (await this._chromeService.getItem(CHROME_KEYS.object)) || null;
    }

    async getTagResponse(): Promise<ZelfIdSearchResponse | null> {
        return (this._variables.response as ZelfIdSearchResponse) || (await this._chromeService.getItem(CHROME_KEYS.response)) || null;
    }

    async getNewTagName(): Promise<string> {
        return (this._variables.newName as string) || (await this._chromeService.getItem(CHROME_KEYS.newName)) || "";
    }

    async getFlow(): Promise<TagFlow> {
        return (this._variables.flow as TagFlow) || (await this._chromeService.getItem(CHROME_KEYS.flow)) || "";
    }

    async getReferral(): Promise<string> {
        return (this._variables.referral as string) || (await this._chromeService.getItem(CHROME_KEYS.referral));
    }

    async getTagName(): Promise<string> {
        return (this._variables.name as string) || (await this._chromeService.getItem(CHROME_KEYS.name));
    }

    async getDuration(): Promise<any> {
        return this._variables.duration || (await this._chromeService.getItem(CHROME_KEYS.duration));
    }

    async getZelfProof(): Promise<string> {
        return (this._variables.proof as string) || (await this._chromeService.getItem(CHROME_KEYS.proof)) || "";
    }

    async getDomain(): Promise<string> {
        return (this._variables.domain as string) || (await this._chromeService.getItem(CHROME_KEYS.domain)) || "zelf";
    }

    parseTagName(tagName: string): { name: string; domain: string } {
        const parts = tagName.split(".");

        if (parts.length < 2) {
            return { name: tagName, domain: "" };
        }

        const domain = parts.pop() || "";
        const name = parts.join(".");

        return { name, domain };
    }

    formatTagName(name: string, domain: string): string {
        return `${name}.${domain}`;
    }
}
