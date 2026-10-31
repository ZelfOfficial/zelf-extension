import { of, Subject } from "rxjs";

import { ZOTP } from "app/models/zotp.model";

import { ZelfAuthenticatorComponent } from "./zelf-authenticator.component";

describe("ZelfAuthenticatorComponent loading state", () => {
    function zotp(id: string): ZOTP {
        return { id, name: `${id}@zelf`, issuer: "Stripe", createdAt: 1, updatedAt: 1 };
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
        };
        const component = new ZelfAuthenticatorComponent(
            { snapshot: { queryParams: {} }, queryParams: of({}) } as any,
            {} as any,
            { detectChanges() {} } as any,
            { onWalletChanged$: walletChanges.asObservable() } as any,
            { navigate: jasmine.createSpy("navigate") } as any,
            {} as any,
            service as any
        );

        return { component, service, zotps$, listLoading$ };
    }

    it("shows the loading state and hides the empty state until the list resolves empty", async () => {
        let resolveLoad: (items: ZOTP[]) => void = () => undefined;
        const { component } = setup(() => new Promise((resolve) => (resolveLoad = resolve)));

        const pending = component.ngOnInit();

        expect(component.showLoadingState).toBeTrue();
        expect(component.showEmptyState).toBeFalse();

        resolveLoad([]);
        await pending;

        expect(component.showLoadingState).toBeFalse();
        expect(component.showEmptyState).toBeTrue();
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
});
