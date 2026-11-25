import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { Injectable } from "@angular/core";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { firstValueFrom } from "rxjs";

import { encryptWalletMasterPassword } from "app/zelf-authenticator/zotp-master-password.util";
import { HttpWrapperService } from "app/http-wrapper.service";
import { TagsService } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import {
    BiometricsBottomSheetComponent,
    BiometricsBottomSheetData,
} from "../../shared/biometrics-bottom-sheet/biometrics-bottom-sheet.component";

import { PasswordShareRequestError, extractPasswordShareErrorCode } from "./password-share.service";

export function isZelfIdentityRequired(error: unknown): boolean {
    const code = error instanceof PasswordShareRequestError ? error.code : extractPasswordShareErrorCode(error);
    return code === "ERR_ZELF_IDENTITY_REQUIRED";
}

type IdentityGrant = { ok: true } | { ok: false; cancelled: boolean; error?: unknown };

/**
 * A share call needs the session stamp that a Zelf Keys save already gets from a face check.
 * Capture the face (and the Zelf ID password when the wallet has one), decrypt the stored name,
 * then let the caller retry the same request once.
 */
@Injectable({
    providedIn: "root",
})
export class PasswordShareIdentityService {
    constructor(
        private _bottomSheet: MatBottomSheet,
        private _dialog: MatDialog,
        private _http: HttpWrapperService,
        private _tags: TagsService,
        private _transloco: TranslocoService,
        private _wallet: WalletService
    ) {}

    async run<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            if (!isZelfIdentityRequired(error)) throw error;

            const grant = await this.grant();
            if (!grant.ok) {
                if (grant.cancelled || !grant.error) throw error;
                throw grant.error;
            }

            return await work();
        }
    }

    async grant(): Promise<IdentityGrant> {
        const wallet = await this._wallet.getCurrentWallet();
        const publicData = wallet?.publicData;
        const tagName = String(publicData?.tagName || wallet?.tagName || wallet?.name || "")
            .split(".")[0]
            .trim()
            .toLowerCase();
        const domain = publicData?.domain || "zelf";

        if (!tagName) return { ok: false, cancelled: true };

        let plainPassword = "";
        if (wallet?.hasPassword) {
            const entered = await this._askPassword();
            if (!entered?.trim()) return { ok: false, cancelled: true };
            plainPassword = entered.trim();
        }

        const face = await this._captureFace();
        let faceBase64 = face?.faceBase64 || "";
        if (!faceBase64) {
            plainPassword = "";
            return { ok: false, cancelled: true };
        }

        let encryptedPassword = "";

        try {
            if (plainPassword) {
                encryptedPassword = (await encryptWalletMasterPassword(this._http, plainPassword)) || "";
                plainPassword = "";
            }

            await this._tags.decryptTag({
                faceBase64,
                tagName,
                domain,
                os: "DESKTOP",
                ...(encryptedPassword ? { password: encryptedPassword } : {}),
            });

            return { ok: true };
        } catch (error) {
            return { ok: false, cancelled: false, error };
        } finally {
            faceBase64 = "";
            plainPassword = "";
            encryptedPassword = "";
            if (face) face.faceBase64 = "";
        }
    }

    private async _askPassword(): Promise<string | undefined> {
        const ref = this._dialog.open(PasswordShareVerifyDialogComponent, {
            panelClass: "zelf-dialog-panel",
            autoFocus: true,
        });
        const result = await firstValueFrom(ref.afterClosed());
        return typeof result === "string" ? result : undefined;
    }

    private _captureFace(): Promise<{ faceBase64?: string } | undefined> {
        const data: BiometricsBottomSheetData = {
            itemData: {
                title: this._transloco.translate("billing.passwords.share.verify_title"),
                instructions: this._transloco.translate("billing.passwords.share.errors.ERR_ZELF_IDENTITY_REQUIRED"),
            },
            itemType: "password",
            mode: "capture",
        };
        const ref = this._bottomSheet.open(BiometricsBottomSheetComponent, {
            data,
            backdropClass: "zelf-backdrop",
            panelClass: "zelf-bottom-sheet-biometrics",
        });

        return firstValueFrom(ref.afterDismissed());
    }
}

@Component({
    selector: "password-share-verify-dialog",
    imports: [CommonModule, FormsModule, MatButtonModule, MatDialogModule, TranslocoModule],
    template: `
        <div class="share-verify" *transloco="let t">
            <h2>{{ t("billing.passwords.share.verify_title") }}</h2>
            <p>{{ t("billing.passwords.share.verify_password_hint") }}</p>
            <input type="password" name="zelf-id-password" autocomplete="current-password" [(ngModel)]="password" />
            <div class="share-verify__actions">
                <button type="button" (click)="cancel()">{{ t("common.cancel") }}</button>
                <button type="button" (click)="confirm()" [disabled]="!password.trim()">
                    {{ t("billing.passwords.share.verify_continue") }}
                </button>
            </div>
        </div>
    `,
    styles: [
        `
            .share-verify {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 20px;
            }
            .share-verify h2,
            .share-verify p {
                margin: 0;
            }
            .share-verify input {
                min-height: 44px;
                padding: 0 12px;
                border-radius: 12px;
                border: 1px solid #e3e3e3;
            }
            .share-verify__actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
        `,
    ],
})
export class PasswordShareVerifyDialogComponent {
    password = "";

    constructor(private _ref: MatDialogRef<PasswordShareVerifyDialogComponent, string | undefined>) {}

    cancel(): void {
        this.password = "";
        this._ref.close(undefined);
    }

    confirm(): void {
        const value = this.password.trim();
        this.password = "";
        if (!value) {
            this._ref.close(undefined);
            return;
        }
        this._ref.close(value);
    }
}
