import { provideHttpClient } from "@angular/common/http";
import { ChangeDetectorRef } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatBottomSheet, MatBottomSheetModule } from "@angular/material/bottom-sheet";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { BehaviorSubject } from "rxjs";

import { ChromeService } from "../chrome.service";
import { TagModel } from "../tags.service";
import { WalletService } from "../wallet.service";
import { ManageDomainsComponent } from "./manage-domains.component";

describe("ManageDomainsComponent", () => {
    let component: ManageDomainsComponent;
    let fixture: ComponentFixture<ManageDomainsComponent>;
    let mockBottomSheet: jasmine.SpyObj<MatBottomSheet>;
    let mockDialog: jasmine.SpyObj<MatDialog>;
    let mockRouter: jasmine.SpyObj<Router>;
    let mockTranslocoService: jasmine.SpyObj<TranslocoService>;
    let mockWalletService: jasmine.SpyObj<WalletService>;
    let mockChromeService: jasmine.SpyObj<ChromeService>;
    let mockChangeDetectorRef: jasmine.SpyObj<ChangeDetectorRef>;

    const today = new Date();
    const oneMonthAgo = new Date(today);
    const oneDayAgo = new Date(today);

    oneMonthAgo.setMonth(today.getMonth() - 1);
    oneDayAgo.setDate(today.getDate() - 1);

    const mockWallet = new TagModel({
        image: "test-image.png",
        publicData: {
            _id: "test-id",
            btcAddress: "btc-address",
            ethAddress: "eth-address",
            expiresAt: oneDayAgo.toISOString(),
            origin: "online",
            registeredAt: oneMonthAgo.toISOString(),
            solanaAddress: "sol-address",
            tagName: "test.zelf",
            type: "mainnet",
        },
    });

    beforeEach(async () => {
        mockBottomSheet = jasmine.createSpyObj("MatBottomSheet", ["open"]);
        mockDialog = jasmine.createSpyObj("MatDialog", ["open"]);
        mockRouter = jasmine.createSpyObj("Router", ["navigate"]);
        mockTranslocoService = jasmine.createSpyObj("TranslocoService", ["translate"]);
        mockWalletService = jasmine.createSpyObj("WalletService", ["getAllWalletsFromStorage", "checkIfLastWallet", "logoutOfWallet"]);
        mockChangeDetectorRef = jasmine.createSpyObj("ChangeDetectorRef", ["detectChanges"]);

        mockChromeService = jasmine.createSpyObj("ChromeService", ["removeItem"], {
            getItem: () => Promise.resolve(null),
            getItemSession: () => Promise.resolve(null),
            setItem: () => Promise.resolve(null),
            onLastVerifiedChanged$: new BehaviorSubject(0).asObservable(),
            onWalletChanged$: new BehaviorSubject({}).asObservable(),
            onWalletsChanged$: new BehaviorSubject([]).asObservable(),
        });

        // Setup default mock returns
        mockWalletService.getAllWalletsFromStorage.and.returnValue(Promise.resolve({ wallet: mockWallet as Partial<TagModel>, wallets: [] }));
        mockWalletService.checkIfLastWallet.and.returnValue(Promise.resolve(false));
        mockTranslocoService.translate.and.returnValue("translated text");

        await TestBed.configureTestingModule({
            imports: [ManageDomainsComponent, MatBottomSheetModule, MatDialogModule, TranslocoModule, RouterModule, NoopAnimationsModule],
            providers: [
                provideHttpClient(),
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: MatDialog, useValue: mockDialog },
                { provide: Router, useValue: mockRouter },
                { provide: TranslocoService, useValue: mockTranslocoService },
                { provide: WalletService, useValue: mockWalletService },
                { provide: ChromeService, useValue: mockChromeService },
                { provide: ChangeDetectorRef, useValue: mockChangeDetectorRef },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ManageDomainsComponent);
        component = fixture.componentInstance;
    });

    it("should create", () => {
        expect(component).toBeTruthy();
    });

    it("should handle wallet download", () => {
        const mockAnchor = {
            href: "",
            download: "",
            click: jasmine.createSpy("click"),
        };

        const mockCreateElement = spyOn(document, "createElement").and.returnValue(mockAnchor as unknown as HTMLAnchorElement);

        component.downloadZelfProof(mockWallet);

        expect(mockCreateElement).toHaveBeenCalledWith("a");
        expect(mockAnchor.href).toBe(mockWallet.image);
        expect(mockAnchor.download).toBe(`zelfproof_${mockWallet.tagName}.png`);
        expect(mockAnchor.click).toHaveBeenCalled();
    });
});
