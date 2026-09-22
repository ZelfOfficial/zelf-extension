import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, Subscription, debounceTime, distinctUntilChanged, filter, map, skip, take, takeUntil, timer } from "rxjs";

import { ChromeService } from "../../chrome.service";
import { PaymentCardItem } from "../../models/zelf-key-item.model";
import { PasswordDataService } from "../../services/password-data.service";
import { PaymentCardDataService } from "../../services/payment-card-data.service";
import { ZelfKeysData, ZelfKeysDataService } from "../../services/zelf-keys-data.service";
import { WalletService } from "../../wallet.service";

export interface VaultItem {
    type: "password" | "card";
    title: string;
    subtitle: string;
    alias: string;
    folder: string;
    raw: any;
}

@Component({
    imports: [CommonModule, TranslocoModule, RouterModule, ReactiveFormsModule],
    selector: "zelf-keys-vault",
    styleUrls: ["./zelf-keys-vault.component.scss"],
    templateUrl: "./zelf-keys-vault.component.html",
})
export class ZelfKeysVaultComponent implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();
    private _expectedOwnerTag: string | null = null;
    private _pollSub: Subscription | null = null;
    private _reinitInFlight = false;

    allItems: VaultItem[] = [];
    filteredItems: VaultItem[] = [];
    loading = true;
    error: string | null = null;
    searchControl = new FormControl("");
    folderControl = new FormControl("");
    noteCount = 0;

    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _passwordDataService: PasswordDataService,
        private _paymentCardDataService: PaymentCardDataService,
        private _router: Router,
        private _translocoService: TranslocoService,
        private _walletService: WalletService,
        private _zelfKeysDataService: ZelfKeysDataService
    ) {}

    public get currentPlan(): string {
        return "premium";
    }

    public set currentPlan(value: string) {}

    async ngOnInit(): Promise<void> {
        this._setupSearchFilter();
        this._subscribeToDataService();
        this._subscribeToLoadingState();
        this._subscribeToErrorState();
        this._subscribeToWalletChanges();

        const wallet = await this._walletService.getCurrentWallet();
        this._expectedOwnerTag = this._zelfKeysDataService.walletTagForCache(wallet);

        await this._zelfKeysDataService.ensureLoadedForCurrentWallet({
            forceRefresh: false,
            reason: "vault-enter",
        });

        this._startWalletPollWatchdog();
    }

    ngOnDestroy(): void {
        this._stopWalletPollWatchdog();
        this.destroy$.next();
        this.destroy$.complete();
    }

    private _subscribeToWalletChanges(): void {
        this._chromeService.onWalletChanged$
            .pipe(
                map((w) => w?.fullTagName ?? ""),
                distinctUntilChanged(),
                filter((tag) => !!tag),
                skip(1),
                takeUntil(this.destroy$)
            )
            .subscribe(() => {
                void this._reinitForCurrentWallet("vault-wallet-switch");
            });
    }

    private _startWalletPollWatchdog(): void {
        this._stopWalletPollWatchdog();

        this._pollSub = timer(3000, 3000)
            .pipe(take(5), takeUntil(this.destroy$))
            .subscribe(() => {
                void this._checkWalletFromStorage("vault-poll-detected-switch");
            });
    }

    private _stopWalletPollWatchdog(): void {
        this._pollSub?.unsubscribe();
        this._pollSub = null;
    }

    private async _checkWalletFromStorage(reason: string): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        const tag = this._zelfKeysDataService.walletTagForCache(wallet);

        if (tag !== this._expectedOwnerTag) {
            await this._reinitForCurrentWallet(reason);
        }
    }

    private async _reinitForCurrentWallet(reason: string): Promise<void> {
        if (this._reinitInFlight) return;

        this._reinitInFlight = true;

        try {
            this.allItems = [];
            this.filteredItems = [];
            this.searchControl.setValue("", { emitEvent: false });
            this.folderControl.setValue("", { emitEvent: false });
            this.loading = true;

            const wallet = await this._walletService.getCurrentWallet();
            this._expectedOwnerTag = this._zelfKeysDataService.walletTagForCache(wallet);

            await this._zelfKeysDataService.reloadForWalletSwitch(reason);
        } finally {
            this._reinitInFlight = false;
            this._startWalletPollWatchdog();
            this._changeDetectorRef.detectChanges();
        }
    }

    private _subscribeToDataService(): void {
        this._zelfKeysDataService.data$.pipe(takeUntil(this.destroy$)).subscribe((data) => {
            void this._applyDataIfCurrentWallet(data);
        });
    }

    private async _applyDataIfCurrentWallet(data: ZelfKeysData | null): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        const expectedTag = this._zelfKeysDataService.walletTagForCache(wallet);

        if (data && this._zelfKeysDataService.dataOwnerTag !== expectedTag) {
            this.allItems = [];
            this.filteredItems = [];
            this.noteCount = 0;
            void this._reinitForCurrentWallet("vault-stale-data");
            return;
        }

        if (!data) {
            this.allItems = [];
            this.filteredItems = [];
            this.noteCount = 0;
            this._changeDetectorRef.detectChanges();
            return;
        }

        const passwords: VaultItem[] = (data.passwords || []).map((p: any) => ({
            type: "password" as const,
            title: this._getPasswordTitle(p),
            subtitle: this._getPasswordSubtitle(p),
            alias: p.publicData?.alias || p.alias || "",
            folder: p.publicData?.folder || p.folder || "",
            raw: p,
        }));

        const cards: VaultItem[] = (data.paymentCards || []).map((c: any) => ({
            type: "card" as const,
            title: this._getCardTitle(c),
            subtitle: this._getCardSubtitle(c),
            alias: c.publicData?.alias || c.alias || "",
            folder: c.publicData?.folder || c.folder || "",
            raw: c,
        }));

        this.allItems = [...passwords, ...cards];
        this.noteCount = data.notes?.length || 0;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    private _subscribeToLoadingState(): void {
        this._zelfKeysDataService.loading$.pipe(takeUntil(this.destroy$)).subscribe((loading) => {
            this.loading = loading;
            this._changeDetectorRef.detectChanges();
        });
    }

    private _subscribeToErrorState(): void {
        this._zelfKeysDataService.error$.pipe(takeUntil(this.destroy$)).subscribe((error) => {
            this.error = error ? this._translocoService.translate("zelf_keys.passwords.error.load_failed") : null;
        });
    }

    private _setupSearchFilter(): void {
        this.searchControl.valueChanges.pipe(debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => this._filterItems());
        this.folderControl.valueChanges.pipe(distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => this._filterItems());
    }

    private _filterItems(): void {
        const lower = (this.searchControl.value || "").trim().toLowerCase();
        const folder = this.folderControl.value || "";

        this.filteredItems = this.allItems.filter((item) => {
            const matchesFolder = !folder || item.folder === folder;
            const matchesSearch =
                !lower ||
                item.title.toLowerCase().includes(lower) ||
                item.subtitle.toLowerCase().includes(lower) ||
                item.alias.toLowerCase().includes(lower) ||
                item.folder.toLowerCase().includes(lower);

            return matchesFolder && matchesSearch;
        });
    }

    get totalCount(): number {
        return this.allItems.length + this.noteCount;
    }

    get passwordCount(): number {
        return this.allItems.filter((item) => item.type === "password").length;
    }

    get cardCount(): number {
        return this.allItems.filter((item) => item.type === "card").length;
    }

    get folders(): string[] {
        return [...new Set(this.allItems.map((item) => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }

    getItemMark(item: VaultItem): string {
        return (item.title.trim().charAt(0) || (item.type === "card" ? "C" : "K")).toUpperCase();
    }

    private _getPasswordTitle(password: any): string {
        if (password.publicData?.website) {
            try {
                return new URL(password.publicData.website).hostname;
            } catch {
                return password.publicData.website;
            }
        }

        if (password.publicData?.title) return password.publicData.title;
        if (password.title) return password.title;

        if (password.name) {
            return (
                password.name
                    ?.replace(/\.png$/, "")
                    .split("_")
                    .pop() || this._translocoService.translate("zelf_keys.data_card.untitled")
            );
        }

        return this._translocoService.translate("zelf_keys.data_card.untitled");
    }

    private _getPasswordSubtitle(password: any): string {
        if (password.publicData?.username) return password.publicData.username;
        if (password.publicData?.description) return password.publicData.description;
        if (password.subtitle) return password.subtitle;
        if (password.publicData?.zelfName) return password.publicData.zelfName;
        return this._translocoService.translate("zelf_keys.data_card.secure_credential");
    }

    private _getMaskedCardNumber(cardNumber: string): string {
        if (!cardNumber) return "•••• ••••";
        const cleaned = cardNumber.replace(/\D/g, "");
        if (cleaned.length < 4) return "•••• " + cleaned;
        const last4 = cleaned.slice(-4);
        return "•••• •••• •••• " + last4;
    }

    private _getCardMetadata(card: any): Record<string, string> {
        const metadata = card?.publicData?.card;

        if (metadata && typeof metadata === "object") return metadata;
        if (typeof metadata !== "string") return {};

        try {
            return JSON.parse(metadata);
        } catch {
            return {};
        }
    }

    private _getCardTitle(card: any): string {
        const metadata = this._getCardMetadata(card);

        return (
            metadata["bankName"] ||
            card.cardName ||
            card.publicData?.cardName ||
            this._translocoService.translate("zelf_keys.data_card.untitled")
        );
    }

    private _getCardSubtitle(card: any): string {
        const metadata = this._getCardMetadata(card);
        const last4 = metadata["last4"];

        if (last4) return `•••• •••• •••• ${last4}`;
        return this._getMaskedCardNumber(card.cardNumber || "");
    }

    onItemClick(item: VaultItem): void {
        if (item.type === "password") {
            this._passwordDataService.setCurrentPassword(item.raw);
            this._router.navigate(["/zelf-keys/passwords/detail"]);
        } else {
            const sourceCard = item.raw.rawData || item.raw;
            const zelfProof =
                item.raw.zelfProof || item.raw.publicData?.zelfProof || sourceCard.zelfProof || sourceCard.publicData?.zelfProof || item.raw.id;

            const publicData = {
                ...(sourceCard.publicData || {}),
                ...(item.raw.publicData || {}),
                type: "credit_card" as const,
                card: item.raw.publicData?.card || sourceCard.publicData?.card || "",
                zelfProof: zelfProof,
            };

            const cardItem: PaymentCardItem & { zelfProof?: string } = {
                id: item.raw.id || sourceCard.id || sourceCard.identifier || "",
                name: item.raw.name || sourceCard.name || "",
                url: item.raw.url || sourceCard.url || "",
                size: item.raw.size || sourceCard.size || 0,
                timestamp: item.raw.timestamp || sourceCard.timestamp || sourceCard.createdAt || new Date().toISOString(),
                publicData: publicData,
                zelfProof: zelfProof,
            };

            this._paymentCardDataService.setCurrentPaymentCard(cardItem);
            this._router.navigate(["/zelf-keys/payment-cards/detail"]);
        }
    }

    onAddPassword(): void {
        this._router.navigate(["/zelf-keys/passwords/new"]);
    }

    onAddCard(): void {
        this._router.navigate(["/zelf-keys/payment-cards/new"]);
    }

    async onRefresh(): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        this._expectedOwnerTag = this._zelfKeysDataService.walletTagForCache(wallet);

        await this._zelfKeysDataService.ensureLoadedForCurrentWallet({
            forceRefresh: true,
            reason: "vault-refresh",
        });
    }

    trackByItem(index: number, item: VaultItem): string {
        return item.type + "-" + (item.raw?.id || item.raw?.publicData?.id || index);
    }
}
