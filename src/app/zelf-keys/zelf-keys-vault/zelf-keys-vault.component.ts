import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit, Optional } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, Subscription, debounceTime, distinctUntilChanged, filter, map, skip, take, takeUntil, timer } from "rxjs";

import { ChromeService } from "../../chrome.service";
import { NoteItem, PaymentCardItem } from "../../models/zelf-key-item.model";
import { NoteDataService } from "../../services/note-data.service";
import { PasswordDataService } from "../../services/password-data.service";
import { PaymentCardDataService } from "../../services/payment-card-data.service";
import { ZelfKeysData, ZelfKeysDataService } from "../../services/zelf-keys-data.service";
import { WalletService } from "../../wallet.service";
import { VaultService } from "../../vault.service";
import { ZelfIdsService } from "../../zelf-ids.service";

import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatMenuModule } from "@angular/material/menu";
import { ZelfKeysPlanUsageComponent } from "../plan-limits/zelf-keys-plan-usage.component";
import { ExportKeyModalComponent } from "../shared/export-key-modal/export-key-modal.component";
import { ImportVaultModalComponent } from "../shared/import-vault-modal/import-vault-modal.component";

export type VaultTabType = "passwords" | "notes" | "cards";
export type VaultViewMode = "list" | "folder";
export type VaultSortOrder = "az" | "za";

export interface VaultItem {
    type: "password" | "note" | "card";
    title: string;
    subtitle: string;
    alias: string;
    folder: string;
    raw: any;
    cardBankName?: string;
    cardMaskedNumber?: string;
    cardHolderName?: string;
    cardExpires?: string;
    qrImageUrl?: string;
}

@Component({
    imports: [CommonModule, TranslocoModule, RouterModule, ReactiveFormsModule, MatDialogModule, MatMenuModule, ZelfKeysPlanUsageComponent],
    selector: "zelf-keys-vault",
    styleUrls: ["./zelf-keys-vault.component.scss"],
    templateUrl: "./zelf-keys-vault.component.html",
})
export class ZelfKeysVaultComponent implements OnInit, OnDestroy {
    static lastSelectedTab: VaultTabType = "passwords";

    private destroy$ = new Subject<void>();
    private _expectedOwnerTag: string | null = null;
    private _pollSub: Subscription | null = null;
    private _reinitInFlight = false;

    allItems: VaultItem[] = [];
    filteredItems: VaultItem[] = [];
    loading = true;
    error: string | null = null;
    needsReverify = false;
    searchControl = new FormControl("");
    folderControl = new FormControl("");
    newFolderControl = new FormControl("");
    noteCount = 0;

    selectedTab: VaultTabType = ZelfKeysVaultComponent.lastSelectedTab;
    viewMode: VaultViewMode = "list";
    sortOrder: VaultSortOrder = "az";
    selectedFolder: string | null = null;
    showListOptions = false;
    showAddSheet = false;
    showNewFolderDialog = false;

    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _dialog: MatDialog,
        private _passwordDataService: PasswordDataService,
        private _paymentCardDataService: PaymentCardDataService,
        private _router: Router,
        private _translocoService: TranslocoService,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _zelfIdsService: ZelfIdsService,
        private _zelfKeysDataService: ZelfKeysDataService,
        @Optional() private _noteDataService?: NoteDataService
    ) {}

    public get currentPlan(): string {
        return "premium";
    }

    public set currentPlan(value: string) {}

    async ngOnInit(): Promise<void> {
        const urlTree = this._router.parseUrl(this._router.url);
        const queryTab = urlTree.queryParams?.["tab"];
        if (queryTab === "passwords" || queryTab === "notes" || queryTab === "cards") {
            this.selectedTab = queryTab;
            ZelfKeysVaultComponent.lastSelectedTab = queryTab;
        }

        this._setupSearchFilter();
        this._subscribeToDataService();
        this._subscribeToLoadingState();
        this._subscribeToErrorState();
        this._subscribeToReverify();
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
            this.selectedFolder = null;
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

        const notes: VaultItem[] = (data.notes || []).map((n: any) => ({
            type: "note" as const,
            title: this._getNoteTitle(n),
            subtitle: "",
            alias: n.publicData?.title || n.title || "",
            folder: n.publicData?.folder || n.folder || "",
            raw: n,
        }));

        const cards: VaultItem[] = (data.paymentCards || []).map((c: any) => {
            const metadata = this._getCardMetadata(c);
            const rawNumber = metadata["number"] || metadata["cardNumber"] || c.cardNumber || "";
            const last4 = metadata["last4"];
            const masked = last4 ? `••••  ••••  ••••  ${last4}` : this._getMaskedCardNumber(rawNumber);
            const bankName = (
                metadata["bankName"] ||
                c.bankName ||
                c.publicData?.bankName ||
                this._translocoService.translate("zelf_keys.vault.na")
            ).toUpperCase();
            const holderName = (
                metadata["name"] ||
                metadata["cardName"] ||
                c.cardName ||
                c.publicData?.cardName ||
                this._translocoService.translate("zelf_keys.vault.card_holder_default")
            ).toUpperCase();
            const expires =
                metadata["expires"] ||
                (metadata["expiryMonth"] && metadata["expiryYear"]
                    ? `${String(metadata["expiryMonth"]).padStart(2, "0")}/${String(metadata["expiryYear"]).slice(-2)}`
                    : this._translocoService.translate("zelf_keys.vault.na"));

            return {
                type: "card" as const,
                title: this._getCardTitle(c),
                subtitle: this._getCardSubtitle(c),
                alias: c.publicData?.alias || c.alias || "",
                folder: c.publicData?.folder || c.folder || "",
                raw: c,
                cardBankName: bankName,
                cardMaskedNumber: masked,
                cardHolderName: holderName,
                cardExpires: expires,
                qrImageUrl: c.url || c.zelfProofQRCode || "",
            };
        });

        this.allItems = [...passwords, ...notes, ...cards];
        this.noteCount = notes.length;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    private _subscribeToLoadingState(): void {
        this._zelfKeysDataService.loading$.pipe(takeUntil(this.destroy$)).subscribe((loading) => {
            this.loading = loading;
            this._changeDetectorRef.detectChanges();
        });
    }

    private _subscribeToReverify(): void {
        this._zelfKeysDataService.needsReverify$.pipe(takeUntil(this.destroy$)).subscribe((needsReverify) => {
            this.needsReverify = needsReverify;
            this._changeDetectorRef.detectChanges();
        });
    }

    private _subscribeToErrorState(): void {
        this._zelfKeysDataService.error$.pipe(takeUntil(this.destroy$)).subscribe((error) => {
            this.error = error ? this._translocoService.translate("zelf_keys.vault.load_error") : null;
        });
    }

    private _setupSearchFilter(): void {
        this.searchControl.valueChanges.pipe(debounceTime(150), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => {
            this._filterItems();
            this._changeDetectorRef.detectChanges();
        });
        this.folderControl.valueChanges.pipe(distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => {
            this._filterItems();
            this._changeDetectorRef.detectChanges();
        });
    }

    private _itemTypeForTab(tab: VaultTabType): VaultItem["type"] {
        if (tab === "notes") return "note";
        if (tab === "cards") return "card";
        return "password";
    }

    private _compareNames(a: string, b: string): number {
        const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
        return this.sortOrder === "az" ? cmp : -cmp;
    }

    private _filterItems(): void {
        const lower = (this.searchControl.value || "").trim().toLowerCase();
        const legacyFolder = this.folderControl.value || "";
        const activeFolder = this.viewMode === "folder" ? this.selectedFolder : legacyFolder || null;
        const targetType = this._itemTypeForTab(this.selectedTab);

        const itemsForTab = this.allItems.filter((item) => item.type === targetType);

        if (this.viewMode === "folder" && !this.selectedFolder && !lower) {
            this.filteredItems = [];
            return;
        }

        this.filteredItems = itemsForTab
            .filter((item) => {
                const matchesFolder = !activeFolder || item.folder === activeFolder;
                const matchesSearch =
                    !lower ||
                    item.title.toLowerCase().includes(lower) ||
                    item.subtitle.toLowerCase().includes(lower) ||
                    item.alias.toLowerCase().includes(lower) ||
                    item.folder.toLowerCase().includes(lower);

                return matchesFolder && matchesSearch;
            })
            .sort((a, b) => this._compareNames(a.alias || a.title, b.alias || b.title));
    }

    get headerTitleKey(): string {
        if (this.selectedTab === "notes") return "zelf_keys.vault.tab_notes";
        if (this.selectedTab === "cards") return "zelf_keys.vault.tab_payments";
        return "zelf_keys.vault.title";
    }

    get emptyMessageKey(): string {
        if (this.selectedTab === "notes") return "zelf_keys.vault.empty_secure_note";
        if (this.selectedTab === "cards") return "zelf_keys.vault.empty_secure_card";
        return "zelf_keys.vault.empty_secure_password";
    }

    get emptyAddLabelKey(): string {
        if (this.selectedTab === "notes") return "zelf_keys.vault.add_new_note";
        if (this.selectedTab === "cards") return "zelf_keys.vault.add_new_card";
        return "zelf_keys.vault.add_new_password";
    }

    get lockedTitleKey(): string {
        if (this.selectedTab === "notes") return "zelf_keys.vault.locked_title_notes";
        if (this.selectedTab === "cards") return "zelf_keys.vault.locked_title_cards";
        return "zelf_keys.vault.locked_title_passwords";
    }

    get activeTabItems(): VaultItem[] {
        const targetType = this._itemTypeForTab(this.selectedTab);
        return this.allItems.filter((item) => item.type === targetType);
    }

    get activeTabFolders(): string[] {
        const folderSet = new Set(
            this.activeTabItems.map((item) => item.folder?.trim()).filter((f): f is string => Boolean(f))
        );
        return [...folderSet].sort((a, b) => this._compareNames(a, b));
    }

    getFolderItemCount(folderName: string): number {
        return this.activeTabItems.filter((item) => item.folder === folderName).length;
    }

    selectTab(tab: VaultTabType): void {
        if (this.selectedTab === tab) return;
        this.selectedTab = tab;
        ZelfKeysVaultComponent.lastSelectedTab = tab;
        this.selectedFolder = null;
        this.showListOptions = false;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    toggleListOptions(): void {
        this.showListOptions = !this.showListOptions;
    }

    closeListOptions(): void {
        this.showListOptions = false;
    }

    setViewMode(mode: VaultViewMode): void {
        this.viewMode = mode;
        this.selectedFolder = null;
        this.showListOptions = false;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    setSortOrder(order: VaultSortOrder): void {
        this.sortOrder = order;
        this.showListOptions = false;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    selectFolder(folderName: string): void {
        this.selectedFolder = folderName;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    clearSelectedFolder(): void {
        this.selectedFolder = null;
        this._filterItems();
        this._changeDetectorRef.detectChanges();
    }

    openAddSheet(): void {
        this.showListOptions = false;
        this.showAddSheet = true;
    }

    closeAddSheet(): void {
        this.showAddSheet = false;
    }

    openCreateFolderDialog(): void {
        this.showAddSheet = false;
        this.newFolderControl.setValue("");
        this.showNewFolderDialog = true;
    }

    closeCreateFolderDialog(): void {
        this.showNewFolderDialog = false;
    }

    confirmCreateFolder(): void {
        const folderName = (this.newFolderControl.value || "").trim().slice(0, 64);
        if (!folderName) return;
        this.showNewFolderDialog = false;
        this.onAddForActiveTab(folderName);
    }

    onAddForActiveTab(folder?: string): void {
        this.showAddSheet = false;
        const queryParams = folder ? { folder } : undefined;
        if (this.selectedTab === "notes") {
            void this._router.navigate(["/zelf-keys/notes/new"], queryParams ? { queryParams } : undefined);
            return;
        }
        if (this.selectedTab === "cards") {
            void this._router.navigate(["/zelf-keys/payment-cards/new"], queryParams ? { queryParams } : undefined);
            return;
        }
        void this._router.navigate(["/zelf-keys/passwords/new"], queryParams ? { queryParams } : undefined);
    }

    get totalCount(): number {
        return this.allItems.length;
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
        if (password.publicData?.alias?.trim()) {
            return password.publicData.alias.trim();
        }

        if (password.publicData?.website) {
            try {
                return new URL(password.publicData.website).hostname;
            } catch {
                return String(password.publicData.website).replace(/^https?:\/\//i, "");
            }
        }

        if (password.publicData?.title) return password.publicData.title;
        if (password.title) return password.title;

        if (password.name) {
            return (
                password.name
                    ?.replace(/\.png$/, "")
                    .split("_")
                    .pop() || this._translocoService.translate("zelf_keys.vault.unknown")
            );
        }

        return this._translocoService.translate("zelf_keys.vault.unknown");
    }

    private _getPasswordSubtitle(password: any): string {
        if (password.publicData?.username) return password.publicData.username;
        if (password.publicData?.description) return password.publicData.description;
        if (password.subtitle) return password.subtitle;
        if (password.publicData?.zelfName) return password.publicData.zelfName;
        return "";
    }

    private _getNoteTitle(note: any): string {
        if (note.publicData?.title?.trim()) return note.publicData.title.trim();
        if (note.title?.trim()) return note.title.trim();
        return this._translocoService.translate("zelf_keys.vault.untitled_note");
    }

    private _getMaskedCardNumber(cardNumber: string): string {
        if (!cardNumber) return "••••  ••••  ••••  ••••";
        if (cardNumber.includes("-")) {
            const parts = cardNumber.split("-");
            if (parts.length === 4) {
                return `••••  ••••  ••••  ${parts[parts.length - 1]}`;
            }
        }
        const cleaned = cardNumber.replace(/\D/g, "");
        if (cleaned.length < 4) return "•••• " + cleaned;
        const last4 = cleaned.slice(-4);
        return "••••  ••••  ••••  " + last4;
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

        if (last4) return `••••  ••••  ••••  ${last4}`;
        return this._getMaskedCardNumber(card.cardNumber || "");
    }

    onItemClick(item: VaultItem): void {
        if (item.type === "password") {
            this._passwordDataService.setCurrentPassword(item.raw);
            void this._router.navigate(["/zelf-keys/passwords/detail"]);
            return;
        }

        if (item.type === "note") {
            const sourceNote = item.raw.rawData || item.raw;
            const zelfProof =
                item.raw.zelfProof || item.raw.publicData?.zelfProof || sourceNote.zelfProof || sourceNote.publicData?.zelfProof || item.raw.id;

            const noteItem: NoteItem & { zelfProof?: string } = {
                id: item.raw.id || sourceNote.id || sourceNote.identifier || "",
                name: item.raw.name || sourceNote.name || "",
                url: item.raw.url || sourceNote.url || "",
                size: item.raw.size || sourceNote.size || 0,
                timestamp: item.raw.timestamp || sourceNote.timestamp || sourceNote.createdAt || new Date().toISOString(),
                publicData: {
                    ...(sourceNote.publicData || {}),
                    ...(item.raw.publicData || {}),
                    type: "notes" as const,
                    title: item.raw.publicData?.title || sourceNote.publicData?.title || item.title,
                    folder: item.raw.publicData?.folder || sourceNote.publicData?.folder,
                    zelfProof,
                },
                zelfProof,
            };

            this._noteDataService?.setCurrentNote(noteItem);
            void this._router.navigate(["/zelf-keys/notes/detail"]);
            return;
        }

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
        void this._router.navigate(["/zelf-keys/payment-cards/detail"]);
    }

    async onReverify(): Promise<void> {
        const wallet = (await this._walletService.getCurrentWallet()) as {
            publicData?: { tagName?: string; domain?: string };
            name?: string;
            zelfProof?: string;
        } | null;
        const publicData = wallet?.publicData || {};
        const tagName = String(publicData.tagName || wallet?.name || "")
            .split(".")[0]
            .toLowerCase();

        if (!tagName) {
            void this._router.navigate(["/welcome-zelfid"]);

            return;
        }

        this._vaultService.password = "";
        await this._zelfIdsService.setTagName(tagName, null);
        await this._zelfIdsService.setDomain(publicData.domain || "zelf");
        await this._zelfIdsService.setZelfProof(wallet?.zelfProof || "");
        await this._zelfIdsService.setTagNameObject(wallet);
        await this._zelfIdsService.setFlow("unlock");
        void this._router.navigate(["/security-zelfid/password"], { queryParams: { return: "/zelf-keys/vault" } });
    }

    onAddPassword(): void {
        void this._router.navigate(["/zelf-keys/passwords/new"]);
    }

    onAddNote(): void {
        void this._router.navigate(["/zelf-keys/notes/new"]);
    }

    onAddCard(): void {
        void this._router.navigate(["/zelf-keys/payment-cards/new"]);
    }

    async onRefresh(): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        this._expectedOwnerTag = this._zelfKeysDataService.walletTagForCache(wallet);

        await this._zelfKeysDataService.ensureLoadedForCurrentWallet({
            forceRefresh: true,
            reason: "vault-refresh",
        });
    }

    async onExportVault(): Promise<void> {
        this.showAddSheet = false;
        const passwordItems = this.allItems
            .filter((item) => item.type === "password")
            .map((item) => item.raw);

        const wallet = await this._walletService.getCurrentWallet();

        this._dialog.open(ExportKeyModalComponent, {
            data: {
                mode: "vault",
                items: passwordItems,
                hasMasterPassword: !!wallet?.hasPassword,
            },
            panelClass: "zelf-dialog-panel",
        });
    }

    async onImportVault(): Promise<void> {
        this.showAddSheet = false;
        const wallet = await this._walletService.getCurrentWallet();

        const dialogRef = this._dialog.open(ImportVaultModalComponent, {
            data: {
                hasMasterPassword: !!wallet?.hasPassword,
            },
            panelClass: "zelf-dialog-panel",
        });

        dialogRef.afterClosed().subscribe((res) => {
            if (res?.imported) {
                void this.onRefresh();
            }
        });
    }

    trackByItem(index: number, item: VaultItem): string {
        return item.type + "-" + (item.raw?.id || item.raw?.publicData?.id || index);
    }
}
