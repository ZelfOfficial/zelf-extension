import { DailyRewardsComponent } from "./daily-rewards.component";

const messages: Record<string, string> = {
    "rewards.error.identity_required": "Face required",
    "rewards.error.verification_failed": "Face mismatch",
    "rewards.error.missing_password": "Password missing",
    "rewards.error.invalid_password": "Wrong password",
    "rewards.error.password_required": "Password required",
    "rewards.error.spin_failed": "Spin failed",
    "rewards.error.already_claimed": "Already claimed",
    "rewards.error.claim_failed": "Claim failed",
};

describe("DailyRewardsComponent identity claim", () => {
    function setup(requiresPassword = false) {
        const sent: Array<Record<string, unknown>> = [];
        const claimDailyReward = jasmine.createSpy("claimDailyReward").and.callFake(async (body: Record<string, unknown>) => {
            sent.push({ ...body });
            return {
                success: true,
                reward: { winningIndex: 1, amount: 4, nextClaimAvailable: "tomorrow" },
            };
        });
        const component = new DailyRewardsComponent(
            { claimDailyReward } as any,
            {} as any,
            {} as any,
            {} as any,
            { translate: (key: string) => messages[key] ?? key } as any,
            { navigate: jasmine.createSpy("navigate").and.resolveTo(true) } as any,
            { markForCheck() {} } as any
        );
        (component as any).tagName = "alice";
        (component as any).domain = "zelf";
        component.requiresMasterPassword = requiresPassword;
        component.isAccountActive = true;
        component.isLoading = false;
        component.segments = [{ value: 1, label: "1", color: "#fff" }];

        return { component, claimDailyReward, sent };
    }

    it("face-only wallet sends faceBase64 without a password", async () => {
        const { component, claimDailyReward, sent } = setup(false);

        await component.spinWheel();
        expect(component.verificationStep).toBe("face");
        expect(claimDailyReward).not.toHaveBeenCalled();

        await component.onFaceCaptured("pgp-face");

        expect(sent.length).toBe(1);
        expect(sent[0]["faceBase64"]).toBe("pgp-face");
        expect(sent[0]["masterPassword"]).toBeUndefined();
        expect(sent[0]["tagName"]).toBe("alice");
        expect(sent[0]["domain"]).toBe("zelf");
        expect(component.masterPassword).toBe("");
        expect((component as any)._secrets.faceBase64).toBe("");
        component.ngOnDestroy();
    });

    it("face and password wallet sends both", async () => {
        const { component, claimDailyReward, sent } = setup(true);

        await component.spinWheel();
        await component.onFaceCaptured("pgp-face");

        expect(claimDailyReward).not.toHaveBeenCalled();
        expect(component.verificationStep).toBe("password");

        component.masterPassword = "secret";
        await component.submitMasterPassword();

        expect(sent.length).toBe(1);
        expect(sent[0]["faceBase64"]).toBe("pgp-face");
        expect(sent[0]["masterPassword"]).toBe("secret");
        expect(component.masterPassword).toBe("");
        expect(component.verificationStep).toBe("none");
        expect((component as any)._secrets.faceBase64).toBe("");
        expect((component as any)._secrets.masterPassword).toBe("");
        component.ngOnDestroy();
    });

    const errorCases: Array<[string, number, string]> = [
        ["ERR_IDENTITY_VERIFICATION_REQUIRED", 400, "Face required"],
        ["ERR_VERIFICATION_FAILED", 422, "Face mismatch"],
        ["ERR_MISSING_PASSWORD", 400, "Password missing"],
        ["ERR_INVALID_PASSWORD", 401, "Wrong password"],
        ["ERR_PASSWORD_REQUIRED", 409, "Password required"],
    ];

    for (const [code, status, message] of errorCases) {
        it(`${code} shows its message and does not claim the day`, async () => {
            const { component, claimDailyReward } = setup(false);
            claimDailyReward.and.callFake(async (body: Record<string, unknown>) => {
                body["faceBase64"] = "";
                throw { status, error: { message: code, code } };
            });

            await component.spinWheel();
            await component.onFaceCaptured("pgp-face");

            expect(component.errorMessage).toBe(message);
            expect(component.wonAmount).toBeNull();
            expect(component.hasSpunToday).toBeFalse();
            expect(component.isSpinning).toBeFalse();
            expect(component.canRetryClaim).toBeTrue();
            expect((component as any)._secrets.faceBase64).toBe("");
            component.ngOnDestroy();
        });
    }

    it("a missing or required password makes the next attempt ask for one", async () => {
        const { component, claimDailyReward } = setup(false);
        claimDailyReward.and.returnValue(Promise.reject({ status: 409, error: { message: "ERR_PASSWORD_REQUIRED", code: "ERR_PASSWORD_REQUIRED" } }));

        await component.spinWheel();
        await component.onFaceCaptured("pgp-face");

        expect(component.requiresMasterPassword).toBeTrue();
        expect(component.hasSpunToday).toBeFalse();
        component.ngOnDestroy();
    });

    it("cancel on the face step claims nothing", async () => {
        const { component, claimDailyReward } = setup(false);

        await component.spinWheel();
        component.cancelVerification();

        expect(claimDailyReward).not.toHaveBeenCalled();
        expect(component.verificationStep).toBe("none");
        expect(component.isSpinning).toBeFalse();
        expect(component.hasSpunToday).toBeFalse();
        expect(component.wonAmount).toBeNull();
        expect(component.errorMessage).toBeNull();
        component.ngOnDestroy();
    });

    it("cancel after the face step drops the capture and claims nothing", async () => {
        const { component, claimDailyReward } = setup(true);

        await component.spinWheel();
        await component.onFaceCaptured("pgp-face");
        component.masterPassword = "secret";
        component.cancelVerification();

        expect(claimDailyReward).not.toHaveBeenCalled();
        expect(component.verificationStep).toBe("none");
        expect(component.masterPassword).toBe("");
        expect(component.hasSpunToday).toBeFalse();
        expect(component.wonAmount).toBeNull();
        expect(component.isSpinning).toBeFalse();
        expect((component as any)._secrets.faceBase64).toBe("");
        expect((component as any)._secrets.masterPassword).toBe("");
        component.ngOnDestroy();
    });
});
