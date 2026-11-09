import { ChangeDetectorRef } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";
import { BehaviorSubject, Subject } from "rxjs";

import { ChromeService } from "../../chrome.service";
import { NoteDataService } from "../../services/note-data.service";
import { PasswordDataService } from "../../services/password-data.service";
import { PaymentCardDataService } from "../../services/payment-card-data.service";
import { ZelfKeysData, ZelfKeysDataService } from "../../services/zelf-keys-data.service";
import { VaultService } from "../../vault.service";
import { WalletService } from "../../wallet.service";
import { ZelfIdsService } from "../../zelf-ids.service";
import { ZelfKeysVaultComponent } from "./zelf-keys-vault.component";

describe("ZelfKeysVaultComponent", () => {
    let component: ZelfKeysVaultComponent;
    let routerSpy: jasmine.SpyObj<Router>;
    let data$: BehaviorSubject<ZelfKeysData | null>;
    let loading$: BehaviorSubject<boolean>;
    let error$: BehaviorSubject<string | null>;
    let needsReverify$: BehaviorSubject<boolean>;
    let noteDataService: NoteDataService;

    beforeEach(() => {
        ZelfKeysVaultComponent.lastSelectedTab = "passwords";
        data$ = new BehaviorSubject<ZelfKeysData | null>({
            passwords: [
                { id: "p1", publicData: { alias: "Zeta", username: "z@z.com", folder: "Work" } },
                { id: "p2", publicData: { alias: "Alpha", username: "a@a.com", folder: "Personal" } },
            ] as any,
            notes: [{ id: "n1", publicData: { title: "Secret Note", folder: "Ideas" } }] as any,
            paymentCards: [
                {
                    id: "c1",
                    publicData: {
                        card: JSON.stringify({
                            bankName: "Chase",
                            last4: "4242",
                            name: "Miguel",
                            expires: "08/29",
                        }),
                    },
                },
            ] as any,
        });
        loading$ = new BehaviorSubject<boolean>(false);
        error$ = new BehaviorSubject<string | null>(null);
        needsReverify$ = new BehaviorSubject<boolean>(false);

        routerSpy = jasmine.createSpyObj<Router>("Router", ["navigate", "parseUrl"]);
        routerSpy.parseUrl.and.returnValue({ queryParams: {} } as any);
        routerSpy.navigate.and.resolveTo(true);

        noteDataService = new NoteDataService();

        const cdr = { detectChanges: jasmine.createSpy("detectChanges") } as unknown as ChangeDetectorRef;
        const chromeService = { onWalletChanged$: new Subject() } as unknown as ChromeService;
        const dialog = { open: jasmine.createSpy("open") } as unknown as MatDialog;
        const passwordDataService = new PasswordDataService();
        const paymentCardDataService = new PaymentCardDataService();
        const translocoService = { translate: (k: string) => k } as unknown as TranslocoService;
        const vaultService = { password: "" } as unknown as VaultService;
        const walletService = {
            getCurrentWallet: jasmine.createSpy("getCurrentWallet").and.resolveTo({ fullTagName: "one610.zelf" }),
        } as unknown as WalletService;
        const zelfIdsService = {} as unknown as ZelfIdsService;
        const zelfKeysDataService = {
            data$: data$.asObservable(),
            loading$: loading$.asObservable(),
            error$: error$.asObservable(),
            needsReverify$: needsReverify$.asObservable(),
            dataOwnerTag: "one610.zelf",
            walletTagForCache: () => "one610.zelf",
            ensureLoadedForCurrentWallet: jasmine.createSpy("ensureLoadedForCurrentWallet").and.resolveTo(),
        } as unknown as ZelfKeysDataService;

        component = new ZelfKeysVaultComponent(
            cdr,
            chromeService,
            dialog,
            passwordDataService,
            paymentCardDataService,
            routerSpy,
            translocoService,
            vaultService,
            walletService,
            zelfIdsService,
            zelfKeysDataService,
            noteDataService
        );
    });

    it("switches headerTitleKey, emptyMessageKey, and emptyAddLabelKey per selected tab (matching Android ZelfKeysHomeHeader)", () => {
        expect(component.headerTitleKey).toBe("zelf_keys.vault.title");
        expect(component.emptyMessageKey).toBe("zelf_keys.vault.empty_secure_password");
        expect(component.emptyAddLabelKey).toBe("zelf_keys.vault.add_new_password");

        component.selectTab("notes");
        expect(component.headerTitleKey).toBe("zelf_keys.vault.tab_notes");
        expect(component.emptyMessageKey).toBe("zelf_keys.vault.empty_secure_note");
        expect(component.emptyAddLabelKey).toBe("zelf_keys.vault.add_new_note");

        component.selectTab("cards");
        expect(component.headerTitleKey).toBe("zelf_keys.vault.tab_payments");
        expect(component.emptyMessageKey).toBe("zelf_keys.vault.empty_secure_card");
        expect(component.emptyAddLabelKey).toBe("zelf_keys.vault.add_new_card");
    });

    it("sorts items A>Z and Z>A and filters by folder in folder view mode", async () => {
        await component.ngOnInit();

        expect(component.filteredItems.map((i) => i.title)).toEqual(["Alpha", "Zeta"]);

        component.setSortOrder("za");
        expect(component.filteredItems.map((i) => i.title)).toEqual(["Zeta", "Alpha"]);

        component.setViewMode("folder");
        expect(component.activeTabFolders).toEqual(["Work", "Personal"]);
        expect(component.filteredItems.length).toBe(0);

        component.selectFolder("Work");
        expect(component.filteredItems.map((i) => i.title)).toEqual(["Zeta"]);

        component.clearSelectedFolder();
        expect(component.selectedFolder).toBeNull();
    });

    it("navigates to the active tab's /new route with ?folder= when confirming Create Folder", () => {
        component.selectTab("notes");
        component.openCreateFolderDialog();
        component.newFolderControl.setValue("Ideas");
        component.confirmCreateFolder();

        expect(routerSpy.navigate).toHaveBeenCalledWith(["/zelf-keys/notes/new"], {
            queryParams: { folder: "Ideas" },
        });
    });

    it("opens note detail when clicking a note item", async () => {
        await component.ngOnInit();
        component.selectTab("notes");

        expect(component.filteredItems.length).toBe(1);
        component.onItemClick(component.filteredItems[0]);

        expect(noteDataService.getCurrentNote()?.id).toBe("n1");
        expect(routerSpy.navigate).toHaveBeenCalledWith(["/zelf-keys/notes/detail"]);
    });
});
