import { NgFor, NgIf } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from "@angular/router";
import { LangDefinition, TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { filter, Subject, takeUntil } from "rxjs";

import { LanguageService } from "app/language.service";
import { FooterNavigationService, FooterNavDestination } from "../zelf-footer/footer-navigation.service";
import { getAppBuildDate, getAppVersion } from "../../environments/version";

@Component({
    imports: [NgFor, NgIf, MatButtonModule, MatMenuModule, RouterLink, RouterLinkActive, TranslocoModule],
    selector: "apps-hub",
    styleUrls: ["./apps-hub.component.scss"],
    templateUrl: "./apps-hub.component.html",
})
export class AppsHubComponent implements OnInit, OnDestroy {
    private readonly _destroy$ = new Subject<void>();

    currentUrl: string = "";
    readonly hubDestinations: FooterNavDestination[];

    activeLang: string;
    readonly availableLangs: LangDefinition[];
    readonly flagCodes: Record<string, string>;

    get appVersion(): string {
        return getAppVersion();
    }

    get buildDate(): string {
        return getAppBuildDate();
    }

    constructor(
        private readonly _router: Router,
        public readonly navService: FooterNavigationService,
        private readonly _languageService: LanguageService,
        private readonly _translocoService: TranslocoService
    ) {
        this.hubDestinations = this.navService.getHubDestinations();
        this.activeLang = this._languageService.getAppLanguage();
        this.availableLangs = this._languageService.getAvailableLanguages();
        this.flagCodes = this._languageService.flagCodes;
    }

    ngOnInit(): void {
        this._updateUrl(this._router.url);

        this._translocoService.langChanges$.pipe(takeUntil(this._destroy$)).subscribe((lang) => {
            this.activeLang = lang;
        });

        this._router.events
            .pipe(
                filter((e) => e instanceof NavigationEnd),
                takeUntil(this._destroy$)
            )
            .subscribe((e: NavigationEnd) => {
                const newUrl = e.urlAfterRedirects || e.url;
                this._updateUrl(newUrl);
            });
    }

    ngOnDestroy(): void {
        this._destroy$.next();
        this._destroy$.complete();
    }

    private _updateUrl(url: string): void {
        this.currentUrl = url.split("?")[0];
    }

    goBack(): void {
        if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
        } else {
            void this._router.navigate(["/home"]);
        }
    }

    rowIsActive(dest: FooterNavDestination): boolean {
        return this.navService.isActive(this.currentUrl, dest.id);
    }

    navigateTo(dest: FooterNavDestination): void {
        void this._router.navigate([dest.route]);
    }

    /** Same persistence as Settings > Language (chrome storage `currentLanguage`). */
    setLanguage(lang: string): void {
        this._languageService.setAppLanguage(lang);
    }

    getLanguageName(lang: string): string {
        return this._languageService.getLanguageName(lang);
    }

}
