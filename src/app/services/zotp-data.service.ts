import { Injectable } from "@angular/core";

import { ZOTP } from "app/models/zotp.model";

@Injectable({
    providedIn: "root",
})
export class ZotpDataService {
    private currentZotp: ZOTP | null = null;

    setCurrentZotp(zotp: ZOTP): void {
        this.currentZotp = zotp;
    }

    getCurrentZotp(): ZOTP | null {
        return this.currentZotp;
    }

    clearCurrentZotp(): void {
        this.currentZotp = null;
    }
}
