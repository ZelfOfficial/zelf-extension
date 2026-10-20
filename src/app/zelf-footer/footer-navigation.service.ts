import { Injectable } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter, map, Observable, startWith } from "rxjs";

export interface FooterNavDestination {
    id: string;
    labelKey: string;
    iconUrl: string;
    route: string;
}

@Injectable({
    providedIn: "root",
})
export class FooterNavigationService {
    public readonly destinations: FooterNavDestination[] = [
        {
            id: "home",
            labelKey: "common.home",
            iconUrl: "assets/icons/home_icon.svg",
            route: "/home",
        },
        {
            id: "wallet",
            labelKey: "common.zelf_wallet",
            iconUrl: "assets/icons/wallet_icon.svg",
            route: "/wallet",
        },
        {
            id: "zelf-keys",
            // Short "Pass" label: the footer pill also holds "+ Add" on deep screens.
            labelKey: "common.keys_short",
            iconUrl: "assets/icons/key_icon.svg",
            route: "/zelf-keys",
        },
        {
            id: "zelf-authenticator",
            labelKey: "common.zelf_authenticator",
            iconUrl: "assets/icons/shield_icon.svg",
            route: "/zelf-authenticator",
        },
        {
            id: "legacy",
            labelKey: "common.legacy",
            iconUrl: "assets/icons/legacy_icon.svg",
            route: "/legacy",
        },
        {
            id: "manage-domains",
            labelKey: "common.manage_domains",
            iconUrl: "assets/icons/zelf_id_icon.svg",
            route: "/manage-domains",
        },
        {
            id: "settings",
            labelKey: "common.settings",
            iconUrl: "assets/icons/settings_icon.svg", // I might need to make sure this icon exists or use a material icon or fallback
            route: "/settings",
        },
    ];

    public activeDestination$: Observable<FooterNavDestination>;

    constructor(private _router: Router) {
        this.activeDestination$ = this._router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            startWith(null),
            map(() => this.getActiveDestination(this._router.url))
        );
    }

    public isActive(url: string, destinationId: string): boolean {
        const cleanUrl = url.split("?")[0];
        
        switch (destinationId) {
            case "home":
                return cleanUrl === "/home";
            case "wallet":
                return cleanUrl === "/wallet";
            case "manage-domains":
                return cleanUrl === "/manage-domains" || cleanUrl.startsWith("/domain") || cleanUrl === "/wallet-manage";
            case "zelf-keys":
                return cleanUrl.startsWith("/zelf-keys");
            case "zelf-authenticator":
                return cleanUrl.startsWith("/zelf-authenticator");
            default:
                const dest = this.destinations.find(d => d.id === destinationId);
                return dest ? cleanUrl.startsWith(dest.route) : false;
        }
    }

    public getActiveDestination(url: string): FooterNavDestination {
        // Find matching destination or fallback to home
        const active = this.destinations.find(d => this.isActive(url, d.id));
        return active || this.destinations[0];
    }

    public async navigate(destinationId: string): Promise<boolean> {
        const dest = this.destinations.find((d) => d.id === destinationId);
        if (dest) {
            return this._router.navigate([dest.route]);
        }
        return false;
    }

    /** Order for the full-page apps hub (Figma "ZELF App 3.0" full menu, #29). zChats, zSignals and zAI are retired. */
    private readonly _hubDestinationIds: string[] = ["home", "wallet", "zelf-keys", "zelf-authenticator", "legacy", "manage-domains"];

    public getHubDestinations(): FooterNavDestination[] {
        return this._hubDestinationIds
            .map((id) => this.destinations.find((d) => d.id === id))
            .filter((d): d is FooterNavDestination => !!d);
    }

    /** Labels for the full-screen Apps Hub list: Wallet, Password Manager, 2FA, Legacy, ID. */
    public hubLabelKey(dest: FooterNavDestination): string {
        switch (dest.id) {
            case "wallet":
                return "apps_hub.label_wallet";
            case "zelf-keys":
                return "apps_hub.label_keys";
            case "zelf-authenticator":
                return "apps_hub.label_auth";
            case "legacy":
                return "apps_hub.label_legacy";
            case "manage-domains":
                return "apps_hub.label_id";
            default:
                return dest.labelKey;
        }
    }
}
