import { ZelfKeysPaymentCardFormComponent } from "./zelf-keys-payment-card-form.component";

describe("ZelfKeysPaymentCardFormComponent (Refs #113)", () => {
    const build = () => {
        const component = new ZelfKeysPaymentCardFormComponent(
            { navigate: jasmine.createSpy("navigate") } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { detectChanges: jasmine.createSpy("detectChanges") } as any,
            {} as any
        );

        component.cardData = {
            alias: "",
            bankName: "Chase",
            cardName: "John Doe",
            cardNumber: "4111111111111111",
            cvv: "",
            expiryMonth: "12",
            expiryYear: "",
            folder: "",
            insideFolder: false,
            masterPassword: "",
            useMasterPassword: false,
        };
        component.hasMasterPassword = false;

        return component;
    };

    describe("expiry year and CVV change handlers", () => {
        it("sanitizes expiry year from the latest ngModelChange value and validates immediately", () => {
            const component = build();

            component.onExpiryYearChange("20a26");
            expect(component.cardData.expiryYear).toBe("2026");

            component.checkFormValidity();
            expect(component.formValid).toBeFalse();

            component.onCvvChange("123");
            expect(component.cardData.cvv).toBe("123");
            expect(component.formValid).toBeTrue();
        });

        it("disables the form when expiry year is cleared after being valid", () => {
            const component = build();

            component.onExpiryYearChange("2026");
            component.onCvvChange("123");
            expect(component.formValid).toBeTrue();

            component.onExpiryYearChange("");
            expect(component.cardData.expiryYear).toBe("");
            expect(component.formValid).toBeFalse();
        });

        it("strips non-digits from CVV using the change event value", () => {
            const component = build();

            component.onExpiryYearChange("2026");
            component.onCvvChange("12x3y");
            expect(component.cardData.cvv).toBe("123");
        });
    });

    describe("expiry inline errors", () => {
        it("shows expired when month/year are complete but in the past", () => {
            const component = build();

            component.cardData.expiryMonth = "01";
            component.onExpiryYearChange("2020");
            component.onCvvChange("123");

            expect(component.expiryError).toBe("expired");
            expect(component.formValid).toBeFalse();
        });

        it("shows invalid when expiry year is outside the allowed range", () => {
            const component = build();
            const farFuture = String(component.maxExpiryYear + 1);

            component.cardData.expiryMonth = "12";
            component.onExpiryYearChange(farFuture);
            component.onCvvChange("123");

            expect(component.expiryError).toBe("invalid");
            expect(component.formValid).toBeFalse();
        });

        it("clears expiry error for a valid future date", () => {
            const component = build();
            const futureYear = String(component.maxExpiryYear);

            component.cardData.expiryMonth = "12";
            component.onExpiryYearChange(futureYear);
            component.onCvvChange("123");

            expect(component.expiryError).toBeNull();
            expect(component.formValid).toBeTrue();
        });
    });
});
