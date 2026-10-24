import { ZelfIdMyPlan } from "./zelf-id-my-plan";
import { ZelfKeysPlanLimitSheetComponent } from "./zelf-keys-plan-limit-sheet.component";

describe("ZelfKeysPlanLimitSheetComponent", () => {
    function sheet(overrides: Partial<ConstructorParameters<typeof ZelfKeysPlanLimitSheetComponent>[0]> = {}) {
        const close = jasmine.createSpy("close");
        const purchase = jasmine.createSpy("purchase").and.resolveTo({ ok: true });
        const translate = (key: string, params?: Record<string, unknown>) => {
            if (key === "zelf_keys.plan_limits.plan.free") return "Free";
            if (key === "zelf_keys.plan_limits.plan.premium") return "Premium";
            if (key === "zelf_keys.plan_limits.plan.unlimited") return "Unlimited";
            if (key === "zelf_keys.plan_limits.sheet.title_passwords") return `You've used all ${params?.["limit"]} passwords on the ${params?.["plan"]} plan`;
            if (key === "zelf_keys.plan_limits.sheet.title_zotp") return `You've used all ${params?.["limit"]} 2FA accounts on the ${params?.["plan"]} plan`;
            if (key === "zelf_keys.plan_limits.sheet.title_over_passwords") {
                return `You have ${params?.["used"]} of ${params?.["limit"]} passwords on the ${params?.["plan"]} plan`;
            }
            if (key === "zelf_keys.plan_limits.sheet.plan_status") return `${params?.["plan"]} plan · expires ${params?.["date"]}`;
            if (key === "zelf_keys.plan_limits.sheet.plan_status_open") return `${params?.["plan"]} plan · no expiration`;
            if (key === "zelf_keys.plan_limits.usage_plan") return `${params?.["plan"]} plan`;

            return key;
        };
        const component = new ZelfKeysPlanLimitSheetComponent(
            {
                kind: "password",
                plan: "free",
                used: 5,
                limit: 5,
                tokenCost: 10,
                tokenBalance: 4,
                balanceAvailable: true,
                hasMasterPassword: false,
                masterPassword: "",
                purchase,
                myPlan: null,
                ...overrides,
            },
            { detectChanges() {} } as any,
            { close } as any,
            { translate, getActiveLang: () => "en" } as any
        );

        return { component, close, purchase };
    }

    it("states the free-plan password cap and disables a purchase the balance cannot cover", () => {
        const { component } = sheet();

        expect(component.title).toBe("You've used all 5 passwords on the Free plan");
        expect(component.lowBalance).toBeTrue();
        expect(component.buyDisabled).toBeTrue();
        expect(component.balanceText).toBe("4");
        expect(component.costText).toBe("10");
    });

    it("states the 2FA cap and keeps buy available when the balance is not known yet", () => {
        const { component } = sheet({
            kind: "zotp",
            used: 3,
            limit: 3,
            tokenCost: 20,
            tokenBalance: null,
            balanceAvailable: false,
        });

        expect(component.title).toBe("You've used all 3 2FA accounts on the Free plan");
        expect(component.lowBalance).toBeFalse();
        expect(component.buyDisabled).toBeFalse();
        expect(component.showBalance).toBeFalse();
    });

    it("prices every slot needed when usage is already over the cap", () => {
        const { component } = sheet({
            used: 6,
            limit: 5,
            tokenCost: 10,
            tokenBalance: 40,
            balanceAvailable: true,
        });

        expect(component.overCap).toBeTrue();
        expect(component.slotsNeeded).toBe(2);
        expect(component.costText).toBe("20");
        expect(component.title).toBe("You have 6 of 5 passwords on the Free plan");
        expect(component.lowBalance).toBeFalse();
    });

    it("buys each extra slot with its own idempotency key", async () => {
        const { component, purchase, close } = sheet({
            used: 6,
            limit: 5,
            tokenCost: 10,
            tokenBalance: 40,
            balanceAvailable: true,
        });

        await component.buy();

        expect(purchase).toHaveBeenCalledTimes(2);
        const keys = purchase.calls.allArgs().map((args) => args[0].idempotencyKey as string);

        expect(keys[0].endsWith("-0")).toBeTrue();
        expect(keys[1].endsWith("-1")).toBeTrue();
        expect(keys[0]).not.toBe(keys[1]);
        expect(close).toHaveBeenCalledWith({ purchased: true });
    });

    it("asks for the master password before starting verification", async () => {
        const { component, purchase } = sheet({
            hasMasterPassword: true,
            masterPassword: "",
            tokenBalance: 40,
            balanceAvailable: true,
        });

        expect(component.showPassword).toBeTrue();

        await component.buy();

        expect(purchase).not.toHaveBeenCalled();
        expect(component.message).toBe("zelf_keys.plan_limits.sheet.password_required");
    });

    it("shows the plan name and expiry, and opens the checkout url", () => {
        const checkout = "https://zelf.world/pricing?tagname=myname&domain=zelf&plan=unlimited";
        const myPlan: ZelfIdMyPlan = {
            plan: "premium",
            duration: "1y",
            expiresAt: "2027-10-24T00:00:00.000Z",
            upgrade: { action: "checkout", url: checkout },
        };
        const { component, close } = sheet({ myPlan });

        expect(component.planStatus).toBe("Premium plan · expires Oct 24, 2027");
        expect(component.showUpgradeButton).toBeTrue();
        expect(component.showPricingNote).toBeFalse();
        expect(component.showMobileNote).toBeFalse();

        component.upgrade();

        expect(close).toHaveBeenCalledWith({ upgrade: true, url: checkout });
    });

    it("hides Upgrade on the top plan", () => {
        const { component, close } = sheet({
            myPlan: {
                plan: "unlimited",
                duration: "lifetime",
                expiresAt: null,
                upgrade: { action: "none", url: null },
            },
        });

        expect(component.showUpgradeButton).toBeFalse();
        expect(component.planStatus).toBe("Unlimited plan · no expiration");

        component.upgrade();

        expect(close).not.toHaveBeenCalled();
    });

    it("shows a mobile-store note and does not open web checkout", () => {
        const { component, close } = sheet({
            myPlan: {
                plan: "premium",
                duration: "1y",
                expiresAt: "2027-10-24T00:00:00.000Z",
                upgrade: { action: "mobile_store", url: null },
            },
        });

        expect(component.showUpgradeButton).toBeFalse();
        expect(component.showMobileNote).toBeTrue();

        component.upgrade();

        expect(close).not.toHaveBeenCalled();
    });
});
