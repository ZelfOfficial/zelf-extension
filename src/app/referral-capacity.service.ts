import { Injectable } from "@angular/core";

import { DomainService } from "./domain.service";
import { environment } from "../environments/environment";
import { HttpWrapperService } from "./http-wrapper.service";
import { evaluateReferralLink, parseReferralAvailability, referralLimitFromLicense, ReferralLinkDecision } from "./referral-capacity";
import { ZelfIdsService } from "./zelf-ids.service";

@Injectable({
    providedIn: "root",
})
export class ReferralCapacityService {
    constructor(
        private _http: HttpWrapperService,
        private _domains: DomainService,
        private _zelfIds: ZelfIdsService
    ) {}

    /**
     * Ask the public availability route, then apply the domain license cap when it is set.
     * A failed lookup is `unknown`: the caller must not store the referral.
     */
    async linkDecision(tagName: string, domain: string): Promise<ReferralLinkDecision> {
        const name = String(tagName || "").trim();
        const tld = String(domain || "").trim();

        if (!name) return "unknown";

        let body: unknown;

        try {
            body = await this._http.sendRequest("get", `${environment.v4ApiUrl}/api/zelf-ids/referral-availability`, {
                tagName: name,
                domain: tld,
            });
        } catch {
            return "unknown";
        }

        const license = this._zelfIds.getDomainLicense(tld) || this._domains.getDomainLicense(tld);

        return evaluateReferralLink(parseReferralAvailability(body), referralLimitFromLicense(license));
    }

    /** True only when this stored referrer is already at the cap. A lookup failure does not block lease. */
    async blocksNewReferral(referralTagName: string, domain: string): Promise<boolean> {
        const name = String(referralTagName || "").trim();

        if (!name) return false;

        return (await this.linkDecision(name, domain)) === "limit_reached";
    }
}
