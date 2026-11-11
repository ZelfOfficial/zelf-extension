import { CommonModule, Location } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog } from "@angular/material/dialog";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { resolveBackNavigation, serializeRouterPreviousUrl } from "app/core/utils/back-navigation.util";
import { ConfirmationDialogComponent } from "app/confirmation-dialog/confirmation-dialog.component";

import { PasswordShareService, PasswordShareSummary } from "./password-share.service";

@Component({
    selector: "password-shares-list",
    imports: [CommonModule, MatButtonModule, TranslocoModule],
    styleUrls: ["./password-shares-list.component.scss"],
    templateUrl: "./password-shares-list.component.html",
})
export class PasswordSharesListComponent implements OnInit {
    loading = true;
    errorMessage = "";
    shares: PasswordShareSummary[] = [];
    revokingId = "";

    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _dialog: MatDialog,
        private _location: Location,
        private _passwordShareService: PasswordShareService,
        private _route: ActivatedRoute,
        private _router: Router,
        private _transloco: TranslocoService
    ) {}

    ngOnInit(): void {
        void this.load();
    }

    async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = "";

        try {
            this.shares = await this._passwordShareService.listShares();
        } catch (error) {
            this.shares = [];
            this.errorMessage = this._passwordShareService.translateError(error);
        } finally {
            this.loading = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    onBack(): void {
        const target = resolveBackNavigation({
            previousUrl: serializeRouterPreviousUrl(this._router),
            redirect: this._route.snapshot.queryParamMap.get("redirect"),
            fallback: "/zelf-keys/vault",
        });

        if (target.kind === "history") {
            this._location.back();
            return;
        }

        void this._router.navigateByUrl(target.url);
    }

    displayLabel(share: PasswordShareSummary): string {
        return share.label || this._transloco.translate("billing.passwords.shares.untitled");
    }

    formattedExpiry(value: string): string {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    remainingKey(count: number): string {
        if (count <= 0) return "billing.passwords.shares.remaining_none";
        if (count === 1) return "billing.passwords.shares.remaining_one";
        return "billing.passwords.shares.remaining_many";
    }

    onRevoke(share: PasswordShareSummary): void {
        const dialogRef = this._dialog.open(ConfirmationDialogComponent, {
            data: {
                title: this._transloco.translate("billing.passwords.shares.revoke_confirm_title"),
                message: this._transloco.translate("billing.passwords.shares.revoke_confirm_message"),
                cancel: this._transloco.translate("common.cancel"),
                confirm: this._transloco.translate("billing.passwords.shares.revoke_confirm"),
                destructiveButton: true,
            },
            panelClass: "zelf-dialog-panel",
        });

        dialogRef.afterClosed().subscribe((confirmed: boolean) => {
            if (!confirmed) return;
            void this.revoke(share);
        });
    }

    private async revoke(share: PasswordShareSummary): Promise<void> {
        this.revokingId = share.id;
        this.errorMessage = "";
        this._changeDetectorRef.detectChanges();

        try {
            await this._passwordShareService.revokeShare(share.id);
            this.shares = this.shares.filter((item) => item.id !== share.id);
        } catch (error) {
            this.errorMessage = this._passwordShareService.translateError(error);
        } finally {
            this.revokingId = "";
            this._changeDetectorRef.detectChanges();
        }
    }
}
