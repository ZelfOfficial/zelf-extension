import { debounce, DebouncedFunc } from "lodash";
import { Subject, take, takeUntil } from "rxjs";

import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { MatMenuModule } from "@angular/material/menu";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { ChromeService } from "app/chrome.service";
import { ConfirmationDialogComponent } from "app/confirmation-dialog/confirmation-dialog.component";
import { CtaSheetComponent } from "app/cta-sheet/cta-sheet.component";
import { FirstLetterPipe } from "app/pipes/first-letter.pipe";
import { TimerPipe } from "app/pipes/timer.pipe";
import { WalletService } from "app/wallet.service";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { TagModel, TagsService, TagSearchResponse } from "app/tags.service";
import { environment } from "environments/environment";

@Component({
    imports: [CommonModule, FirstLetterPipe, MatMenuModule, RouterModule, TimerPipe, TranslocoModule, ZelfLoaderComponent],
    selector: "manage-domains",
    styleUrls: ["./manage-domains.component.scss"],
    templateUrl: "./manage-domains.component.html",
})
export class ManageDomainsComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();
    private _loadWalletsDebounced: DebouncedFunc<() => void>;

    loading: boolean = false;
    deleting: boolean = false;
    wallets: Partial<TagModel>[] = [];
    currentWallet: Partial<TagModel> = {};

    constructor(
        private _bottomSheet: MatBottomSheet,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _dialog: MatDialog,
        private _router: Router,
        private _snackBar: MatSnackBar,
        private _translocoService: TranslocoService,
        private _walletService: WalletService,
        private _tagsService: TagsService
    ) {
        this._loadWalletsDebounced = debounce(this._loadWallets, 1000);
    }

    ngOnInit(): void {
        this._chromeService.onWalletChanged$.pipe(take(1)).subscribe(this._initLoadWallets);
        this._chromeService.onWalletsChanged$.pipe(take(1)).subscribe(this._initLoadWallets);
    }

    ngOnDestroy(): void {
        this._loadWalletsDebounced?.cancel();

        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    /**
     * Initializes the wallets list and refreshes the wallets.
     * @returns void
     */
    private _initLoadWallets = async (): Promise<void> => {
        if (this.loading) return;

        this.loading = true;

        await this._setWallets();

        await this._refreshWallets();

        this._chromeService.onWalletChanged$.pipe(takeUntil(this.unsubscriber$)).subscribe(this._loadWalletsDebounced);
        this._chromeService.onWalletsChanged$.pipe(takeUntil(this.unsubscriber$)).subscribe(this._loadWalletsDebounced);
    };

    /**
     * Loads the wallets list and refreshes the wallets.
     * @returns void
     */
    private _loadWallets = () => {
        if (this.loading) return;

        this.loading = true;

        this._setWallets().finally(() => {
            this.loading = false;

            this._changeDetectorRef.detectChanges();
        });
    };

    /**
     * Opens the delete confirmation dialog.
     * @param isLastWallet - Whether the wallet is the last wallet.
     * @param wallet - The wallet to delete.
     * @returns void
     */
    private _openDeleteConfirmationDialog(isLastWallet: boolean, wallet: Partial<TagModel> = {}): void {
        let message = "";

        if (wallet?.publicData?.isFullyExpired || wallet?.publicData?.isExpiringSoon) {
            message = this._translocoService.translate("manage_domains.expired_wallet_logout_message");
        } else {
            message = this._translocoService.translate("manage_domains.logout_of_wallet_message");
        }

        const dialogRef = this._dialog.open(ConfirmationDialogComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            data: {
                cancel: this._translocoService.translate("common.cancel"),
                confirm: this._translocoService.translate("common.remove"),
                destructiveButton: true,
                message,
                title: this._translocoService.translate("manage_domains.are_you_sure_you_want_to_delete"),
            },
        });

        dialogRef.afterClosed().subscribe(async (confirmed) => {
            if (!confirmed) return;

            if (isLastWallet) {
                this._chromeService.clearLocalStorage();
                this._chromeService.clearSessionStorage();

                this._router.navigate(["/welcome-zelfid"], { replaceUrl: true });

                return;
            }

            // Prevent multiple simultaneous deletions
            if (this.deleting) return;

            // Delete the wallet
            try {
                this.deleting = true;
                this._changeDetectorRef.detectChanges();

                await this._walletService.deleteZelfProof(wallet as TagModel);

                // Refresh the wallets list
                await this._setWallets();

                // Show success message
                this._snackBar.open(
                    this._translocoService.translate("manage_domains.zelfproof_removed_successfully"),
                    this._translocoService.translate("common.close"),
                    {
                        duration: 3000,
                        panelClass: "zelf-snackbar",
                        verticalPosition: "top",
                    }
                );
            } catch (error) {
                console.error("Error deleting ZelfProof:", error);

                // Show error message
                this._snackBar.open(
                    this._translocoService.translate("errors.something_went_wrong"),
                    this._translocoService.translate("common.close"),
                    {
                        duration: 5000,
                        panelClass: "zelf-snackbar",
                        verticalPosition: "top",
                    }
                );
            } finally {
                this.deleting = false;
                this._changeDetectorRef.detectChanges();
            }
        });
    }

    /**
     * Opens the CTASheet.
     * @param wallet - The wallet to open the CTASheet for.
     * @returns void
     */
    private _openCTASheet(wallet: Partial<TagModel>): void {
        const bottomSheetRef = this._bottomSheet.open(CtaSheetComponent, {
            backdropClass: "zelf-backdrop",
            panelClass: "zelf-bottom-sheet",
            height: "100vh",
            maxHeight: "100vh",
            data: { wallet },
        });

        bottomSheetRef.afterDismissed().subscribe((confirmed) => {
            if (!confirmed) return;

            this._router.navigate(["/domain"], { queryParams: { zelfName: wallet.tagName } });
        });
    }

    /**
     * Refreshes the wallets.
     * @returns void
     */
    private _refreshWallets = async (): Promise<void> => {
        await this._tagsService.refreshAllTagsPublicData(this.wallets as TagModel[], true);
    };

    /**
     * Sets the wallets.
     * @returns void
     */
    private async _setWallets(): Promise<void> {
        const { wallet, wallets } = await this._walletService.getAllWalletsFromStorage();
        const seenWallets = new Set<string>();

        // Filter out empty wallets and guard against duplicates between `wallet` and `wallets`.
        const validWallets = [wallet, ...wallets].filter((w) => {
            if (!w || (!w.tagName && !w.name && !w.publicData?.tagName)) return false;

            const walletKey = w.fullTagName || w.publicData?.tagName || w.name || w.tagName;

            if (!walletKey || seenWallets.has(walletKey)) return false;

            seenWallets.add(walletKey);

            return true;
        }) as TagModel[];

        this.currentWallet = wallet && (wallet.tagName || wallet.name || wallet.publicData?.tagName) ? wallet : validWallets[0] || ({} as TagModel);
        this.wallets = validWallets;
        this.loading = false;

        this._changeDetectorRef.detectChanges();
    }

    /**
     * Downloads the ZelfProof.
     * @param wallet - The wallet to download the ZelfProof for.
     * @returns void
     */
    downloadZelfProof(wallet: Partial<TagModel>): void {
        if (!wallet.name) return;

        const link = document.createElement("a");

        link.href = wallet?.image as string;
        link.download = `zelfproof_${wallet?.tagName}.png`;
        link.click();
    }

    /**
     * Navigates to the domain.
     * @param wallet - The wallet to navigate to the domain for.
     * @returns void
     */
    goToDomain(wallet: Partial<TagModel>): void {
        if (this.showDetails(wallet)) {
            this._openCTASheet(wallet);

            return;
        }

        this._router.navigate(["/domain"], { queryParams: { zelfName: wallet.tagName } });
    }

    /**
     * Navigates to the purchase.
     * @param wallet - The wallet to navigate to the purchase for.
     * @returns void
     */
    goToPurchase(wallet: Partial<TagModel>): void {
        const name = wallet?.tagName || wallet?.publicData?.tagName || wallet?.name || "";
        const domain = wallet.publicData?.domain || "zelf";
        const duration = 1;

        this._router.navigate(["/external-link"], {
            queryParams: {
                externalUrl: `${environment.paymentDomainUrl}?tagname=${name}&domain=${domain}&duration=${duration}`,
            },
        });
    }

    /**
     * Navigates to the recovery.
     * @param wallet - The wallet to navigate to the recovery for.
     * @returns void
     */
    async goToRecovery(wallet: Partial<TagModel>): Promise<void> {
        const tagModel = wallet as TagModel;

        // Get tagName (just the name part, without domain)
        const tagName = tagModel?.tagName || wallet?.publicData?.tagName?.split(".")[0] || wallet?.name?.split(".")[0] || "";

        // Get domain separately
        const domain = tagModel?.domain || wallet?.publicData?.domain || "zelf";

        // Check if tag is available (doesn't exist in IPFS/Arweave)
        // The available property is already set during wallet refresh, no need for additional API call
        const isAvailable = (tagModel as TagModel)?.available === true;

        await this._tagsService.setTagName(tagName);
        await this._tagsService.setDomain(domain);

        await this._tagsService.setZelfProof(wallet.zelfProof || "");

        await this._walletService.setWalletsToColdStorage();

        if (isAvailable) {
            this._router.navigate(["/welcome-zelfid/find"]);

            return;
        }

        // Create tagResponse from wallet data for welcome-grace
        if (wallet) {
            const tagResponse: TagSearchResponse = {
                ipfs: [],
                arweave: [],
                available: false,
                tagName: tagModel?.tagName,
                tagObject: wallet as any,
            };

            await this._tagsService.setTagResponse(tagResponse);
        }

        this._router.navigate(["/welcome-zelfid/grace"]);
    }

    /**
     * Deletes the ZelfProof.
     * @param wallet - The wallet to delete the ZelfProof for.
     * @returns void
     */
    async deleteZelfProof(wallet: Partial<TagModel>): Promise<void> {
        if (!wallet.name) return;

        const isLastWallet = await this._walletService.checkIfLastWallet();

        if (!isLastWallet) return this._openDeleteConfirmationDialog(isLastWallet, wallet as TagModel);

        this._openDeleteConfirmationDialog(isLastWallet);
    }

    /**
     * Shows the details.
     * @param wallet - The wallet to show the details for.
     * @returns boolean
     */
    showDetails(wallet: Partial<TagModel>): boolean {
        return Boolean(
            wallet.publicData?.isFullyExpired ||
            wallet.publicData?.isExpiringSoon ||
            wallet.publicData?.isInGracePeriod ||
            wallet.publicData?.isExpired
        );
    }
}
