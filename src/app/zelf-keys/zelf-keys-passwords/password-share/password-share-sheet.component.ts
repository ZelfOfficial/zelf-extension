import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from "@angular/material/bottom-sheet";
import { Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { CopyToClipboardBase } from "app/base/copy-to-clipboard/copy-to-clipboard.base";
import { ChromeService } from "app/chrome.service";
import { MatSnackBar } from "@angular/material/snack-bar";

import { PasswordShareExpiration } from "./password-share-crypto";
import { PasswordShareService } from "./password-share.service";

export interface PasswordShareSheetData {
    title: string;
    username: string;
    password: string;
    url: string;
    notes: string;
    /** Dev preview only. Skips the form and shows a prepared link. */
    initialView?: "form" | "result";
    previewLink?: string;
    previewExpiresAt?: string;
    previewMaxViews?: number;
}

@Component({
    selector: "password-share-sheet",
    imports: [CommonModule, FormsModule, TranslocoModule],
    styleUrls: ["./password-share-sheet.component.scss"],
    templateUrl: "./password-share-sheet.component.html",
})
export class PasswordShareSheetComponent extends CopyToClipboardBase {
    readonly expirationOptions: PasswordShareExpiration[] = ["1h", "1d", "7d", "30d"];

    view: "form" | "result" = "form";
    expiration: PasswordShareExpiration = "7d";
    maxViews = 1;
    includeUsername: boolean;
    includeWebsite: boolean;
    includeNotes: boolean;
    label: string;
    creating = false;
    errorMessage = "";
    link = "";
    expiresAt = "";

    constructor(
        @Inject(MAT_BOTTOM_SHEET_DATA) public data: PasswordShareSheetData,
        private _bottomSheetRef: MatBottomSheetRef<PasswordShareSheetComponent>,
        private _changeDetectorRef: ChangeDetectorRef,
        private _passwordShareService: PasswordShareService,
        private _router: Router,
        chromeService: ChromeService,
        snackBar: MatSnackBar,
        translocoService: TranslocoService
    ) {
        super(chromeService, snackBar, translocoService);
        this.includeUsername = !!data.username?.trim();
        this.includeWebsite = !!data.url?.trim();
        this.includeNotes = false;
        this.label = data.title || "";

        if (data.initialView === "result" && data.previewLink) {
            this.view = "result";
            this.link = data.previewLink;
            this.expiresAt = data.previewExpiresAt || "";
            this.maxViews = data.previewMaxViews || 1;
        }
    }

    get hasUsername(): boolean {
        return !!this.data.username?.trim();
    }

    get hasWebsite(): boolean {
        return !!this.data.url?.trim();
    }

    get hasNotes(): boolean {
        return !!this.data.notes?.trim();
    }

    close(): void {
        this._bottomSheetRef.dismiss();
    }

    selectExpiration(option: PasswordShareExpiration): void {
        this.expiration = option;
    }

    decreaseViews(): void {
        if (this.maxViews > 1) this.maxViews -= 1;
    }

    increaseViews(): void {
        if (this.maxViews < 10) this.maxViews += 1;
    }

    async createLink(): Promise<void> {
        if (this.creating) return;

        this.creating = true;
        this.errorMessage = "";

        try {
            const created = await this._passwordShareService.createShare({
                title: this.data.title,
                password: this.data.password,
                username: this.includeUsername ? this.data.username : undefined,
                url: this.includeWebsite ? this.data.url : undefined,
                notes: this.includeNotes ? this.data.notes : undefined,
                expiresIn: this.expiration,
                maxViews: this.maxViews,
                label: this.label,
            });

            this.link = created.link;
            this.expiresAt = created.expiresAt;
            this.maxViews = created.maxViews;
            this.view = "result";
        } catch (error) {
            this.errorMessage = this._passwordShareService.translateError(error);
        } finally {
            this.creating = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    copyLink(): void {
        if (!this.link) return;
        void this._copyToClipboard(this.link);
    }

    openSharedLinks(): void {
        this._bottomSheetRef.dismiss();
        void this._router.navigate(["/zelf-keys/shares"]);
    }

    formattedExpiry(): string {
        if (!this.expiresAt) return "";
        const date = new Date(this.expiresAt);
        if (Number.isNaN(date.getTime())) return this.expiresAt;
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }
}
