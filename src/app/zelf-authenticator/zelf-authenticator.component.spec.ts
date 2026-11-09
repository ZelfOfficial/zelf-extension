import { of, Subject } from "rxjs";

import { ZOTP } from "app/models/zotp.model";

import { ZelfAuthenticatorComponent } from "./zelf-authenticator.component";

describe("ZelfAuthenticatorComponent", () => {
    function zotp(id: string, issuer: string = "Stripe"): ZOTP {
        return { id, name: `${id}@zelf`, issuer, createdAt: 1, updatedAt: 1 };
    }

    function setup(load: () => Promise<ZOTP[]>) {
        const walletChanges = new Subject<any>();
        const zotps$ = new Subject<ZOTP[] | null>();
        const listLoading$ = new Subject<boolean>();
        const service = {
            zotps$: zotps$.asObservable(),
            listLoading$: listLoading$.asObservable(),
            listLoading: false,
            currentList: null as ZOTP[] | null,
            loadZOTPsFromBackend: jasmine.createSpy("loadZOTPsFromBackend").and.callFake(load),
            clearCache: jasmine.createSpy("clearCache"),
            ensureZotpProof: jasmine.createSpy("ensureZotpProof").and.callFake(async (item: ZOTP) => ({
                ...item,
                zelfProof: "proof-123",
            })),
            retrieveZOTPSecretWithParams: jasmine
                .createSpy("retrieveZOTPSecretWithParams")
                .and.callFake(async (item: ZOTP) => ({
                    secret: "JBSWY3DPEHPK3PXP",
                    zotp: item,
                })),
        };
        const totpService = {
            generate: jasmine.createSpy("generate").and.resolveTo("654321"),
        };
        const component = new ZelfAuthenticatorComponent(
            { snapshot: { queryParams: {} }, queryParams: of({}) } as any,
            {} as any,
            { detectChanges() {} } as any,
            { onWalletChanged$: walletChanges.asObservable() } as any,
            { navigate: jasmine.createSpy("navigate") } as any,
            { setCurrentZotp: jasmine.createSpy("setCurrentZotp") } as any,
            service as any,
            undefined,
            undefined,
            undefined,
            totpService as any,
            undefined
        );

        return { component, service, totpService, zotps$, listLoading$ };
    }

    it("shows the loading state and hides the empty state until the list resolves empty", async () => {
        let resolveLoad: (items: ZOTP[]) => void = () => undefined;
        const { component } = setup(() => new Promise((resolve) => (resolveLoad = resolve)));

        const pending = component.ngOnInit();

        expect(component.showLoadingState).toBeTrue();
        expect(component.showEmptyState).toBeFalse();
        expect(component.showFab).toBeFalse();

        resolveLoad([]);
        await pending;

        expect(component.showLoadingState).toBeFalse();
        expect(component.showEmptyState).toBeTrue();
        expect(component.showFab).toBeTrue();
    });

    it("shows saved 2FAs and not the empty state when the list returns items", async () => {
        const items = [zotp("1"), zotp("2"), zotp("3")];
        const { component } = setup(async () => items);

        await component.ngOnInit();

        expect(component.showLoadingState).toBeFalse();
        expect(component.showEmptyState).toBeFalse();
        expect(component.zotps.length).toBe(3);
        expect(component.filteredZotps.length).toBe(3);
    });

    it("uses issuer as primary display title when present and masks locked codes as ••••••••", async () => {
        const itemWithIssuer = zotp("miguel", "GitHub");
        const itemWithoutIssuer = zotp("miguel", "");
        const { component } = setup(async () => [itemWithIssuer, itemWithoutIssuer]);

        await component.ngOnInit();

        expect(component.getDisplayTitle(itemWithIssuer)).toBe("GitHub");
        expect(component.hasIssuer(itemWithIssuer)).toBeTrue();
        expect(component.getItemMark(itemWithIssuer)).toBe("G");
        expect(component.getDisplayCode(itemWithIssuer)).toBe("••••••••");

        expect(component.getDisplayTitle(itemWithoutIssuer)).toBe("miguel@zelf");
        expect(component.hasIssuer(itemWithoutIssuer)).toBeFalse();
        expect(component.getItemMark(itemWithoutIssuer)).toBe("M");
    });

    it("unlocks all shown codes via Show codes and hides them via Hide codes", async () => {
        const items = [zotp("1", "GitHub"), zotp("2", "Google")];
        const { component } = setup(async () => items);

        await component.ngOnInit();
        expect(component.allShownCodesRevealed).toBeFalse();

        await component.onToggleAllCodes();
        expect(component.showBiometrics).toBeTrue();

        await component.onBiometricsScanned("encrypted-face");
        expect(component.allShownCodesRevealed).toBeTrue();
        expect(component.getDisplayCode(items[0])).toBe("654 321");
        expect(component.getDisplayCode(items[1])).toBe("654 321");

        await component.onToggleAllCodes();
        expect(component.allShownCodesRevealed).toBeFalse();
        expect(component.getDisplayCode(items[0])).toBe("••••••••");
    });
});
