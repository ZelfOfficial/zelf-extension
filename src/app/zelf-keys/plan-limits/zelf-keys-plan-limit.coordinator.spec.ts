import { from, of } from "rxjs";

import { ErrorService } from "app/services/error.service";
import { ZelfKeysPlanLimitCoordinator } from "./zelf-keys-plan-limit.coordinator";
import { PlanLimitPurchaseResult, ZelfKeysLimits } from "./zelf-keys-plan-limits.model";

const atCap: ZelfKeysLimits = {
    plan: "free",
    tokenBalance: 40,
    onChainBalance: 40,
    tokensSpent: 0,
    tokenPriceUsd: 0.05,
    balanceAvailable: true,
    kinds: {
        password: {
            used: 5,
            limit: 5,
            planLimit: 5,
            extraSlots: 0,
            activeExtraSlots: [],
            tokenCost: 10,
            slotUsd: 0.5,
            canAdd: false,
        },
        zotp: {
            used: 1,
            limit: 3,
            planLimit: 3,
            extraSlots: 0,
            activeExtraSlots: [],
            tokenCost: 20,
            slotUsd: 1,
            canAdd: true,
        },
    },
};

describe("ZelfKeysPlanLimitCoordinator", () => {
    function setup() {
        const getVaultLimits = jasmine.createSpy("getVaultLimits").and.resolveTo({ status: "ok", limits: atCap });
        const purchaseExtraSlot = jasmine.createSpy("purchaseExtraSlot").and.resolveTo({ data: { kind: "password" } });
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const dialogOpen = jasmine.createSpy("open").and.returnValue({ afterClosed: () => of(undefined) });
        const bottomOpen = jasmine.createSpy("open").and.returnValue({ afterDismissed: () => of({ faceBase64: "face" }) });
        const encryptMessage = jasmine.createSpy("encryptMessage").and.callFake(async (value: string) => `pgp:${value}`);
        const coordinator = new ZelfKeysPlanLimitCoordinator(
            { open: bottomOpen } as any,
            { open: dialogOpen } as any,
            new ErrorService({ translate: (key: string) => key } as any),
            { encryptMessage } as any,
            { getVaultLimits, purchaseExtraSlot } as any,
            { navigate } as any,
            { translate: (key: string) => key } as any
        );

        return { coordinator, getVaultLimits, purchaseExtraSlot, navigate, dialogOpen, bottomOpen, encryptMessage };
    }

    function closeWithPurchase(dialogOpen: jasmine.Spy, input: { masterPassword: string; idempotencyKey: string }): void {
        dialogOpen.and.callFake((_component: unknown, config: { data: { purchase: (value: typeof input) => Promise<PlanLimitPurchaseResult> } }) => ({
            afterClosed: () =>
                from(config.data.purchase(input).then((result) => (result.ok ? { purchased: true } : {}))),
        }));
    }

    it("lets a save continue when /limits is not on this API", async () => {
        const { coordinator, getVaultLimits, dialogOpen } = setup();

        getVaultLimits.and.resolveTo({ status: "unsupported" });

        await expectAsync(coordinator.ensureCanAdd("password", { hasMasterPassword: false })).toBeResolvedTo(true);
        expect(dialogOpen).not.toHaveBeenCalled();
        expect(coordinator.limits).toBeNull();
    });

    it("lets a save continue when the cap is not reached", async () => {
        const { coordinator, dialogOpen } = setup();

        await expectAsync(coordinator.ensureCanAdd("zotp", { hasMasterPassword: false })).toBeResolvedTo(true);
        expect(dialogOpen).not.toHaveBeenCalled();
    });

    it("stops a save when the sheet is dismissed", async () => {
        const { coordinator, dialogOpen } = setup();

        await expectAsync(coordinator.ensureCanAdd("password", { hasMasterPassword: true, masterPassword: "secret" })).toBeResolvedTo(false);
        expect(dialogOpen).toHaveBeenCalled();

        const data = dialogOpen.calls.mostRecent().args[1].data;

        expect(data.kind).toBe("password");
        expect(data.limit).toBe(5);
        expect(data.tokenCost).toBe(10);
        expect(data.masterPassword).toBe("secret");
    });

    it("buys a slot with face only when the wallet has no master password, then continues the save", async () => {
        const { coordinator, dialogOpen, purchaseExtraSlot, encryptMessage } = setup();

        closeWithPurchase(dialogOpen, { masterPassword: "", idempotencyKey: "idem-key-123" });

        await expectAsync(coordinator.ensureCanAdd("password", { hasMasterPassword: false })).toBeResolvedTo(true);

        expect(purchaseExtraSlot).toHaveBeenCalledWith({
            kind: "password",
            idempotencyKey: "idem-key-123",
            faceBase64: "face",
        });
        expect(encryptMessage).not.toHaveBeenCalled();
    });

    it("encrypts the master password when the wallet has one", async () => {
        const { coordinator, dialogOpen, purchaseExtraSlot } = setup();

        closeWithPurchase(dialogOpen, { masterPassword: "secret", idempotencyKey: "idem-key-123" });

        await expectAsync(coordinator.ensureCanAdd("password", { hasMasterPassword: true, masterPassword: "secret" })).toBeResolvedTo(true);

        expect(purchaseExtraSlot).toHaveBeenCalledWith({
            kind: "password",
            idempotencyKey: "idem-key-123",
            faceBase64: "face",
            masterPassword: "pgp:secret",
        });
    });

    it("leaves non-limit save errors to the caller", async () => {
        const { coordinator, dialogOpen } = setup();

        await expectAsync(
            coordinator.recoverFromSaveError(
                { status: 409, error: { code: "ERR_INVALID_SETUP_KEY", message: "ERR_INVALID_SETUP_KEY" } },
                "zotp",
                { hasMasterPassword: false }
            )
        ).toBeResolvedTo("not-limit");
        expect(dialogOpen).not.toHaveBeenCalled();
    });

    it("navigates to billing when the sheet asks to upgrade", async () => {
        const { coordinator, dialogOpen, navigate } = setup();

        dialogOpen.and.returnValue({ afterClosed: () => of({ upgrade: true }) });

        await expectAsync(coordinator.ensureCanAdd("password", { hasMasterPassword: false })).toBeResolvedTo(false);
        expect(navigate).toHaveBeenCalledWith(["/zelf-keys/billing"]);
    });
});
