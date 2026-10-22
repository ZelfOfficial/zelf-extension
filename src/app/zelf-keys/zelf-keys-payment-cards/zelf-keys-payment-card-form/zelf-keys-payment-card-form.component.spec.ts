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

        it("writes sanitized digits back to the expiry year input when the model does not change", () => {
            const component = build();
            const input = document.createElement("input");

            for (const value of ["2", "20", "20a", "20a2", "20a2x", "20a2x6"]) {
                input.value = value;
                component.onExpiryYearChange(value, input);
            }

            expect(component.cardData.expiryYear).toBe("2026");
            expect(input.value).toBe("2026");
        });

        it("writes sanitized digits back to the CVV and card number inputs", () => {
            const component = build();
            const cvvInput = document.createElement("input");
            cvvInput.value = "12a";
            component.onCvvChange("12a", cvvInput);
            expect(component.cardData.cvv).toBe("12");
            expect(cvvInput.value).toBe("12");

            const cardInput = document.createElement("input");
            cardInput.value = "4111a";
            component.onCardNumberChange("4111a", cardInput);
            expect(component.cardData.cardNumber).toBe("4111");
            expect(cardInput.value).toBe("4111");
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

    describe("pasting into digits-only fields (Refs #114)", () => {
        const mounted: HTMLInputElement[] = [];

        afterEach(() => {
            for (const input of mounted) input.remove();
            mounted.length = 0;
        });

        const field = (id: string, maxLength: number, value = "") => {
            const input = document.createElement("input");
            input.id = id;
            input.maxLength = maxLength;
            input.value = value;
            document.body.appendChild(input);
            input.setSelectionRange(0, value.length);
            mounted.push(input);
            return input;
        };

        const clipboard = (text: string) => ({
            getData: (type: string) => (type === "text" || type === "text/plain" ? text : ""),
        });

        const paste = (component: ZelfKeysPaymentCardFormComponent, input: HTMLInputElement, text: string) => {
            const preventDefault = jasmine.createSpy("preventDefault");
            const event = {
                target: input,
                clipboardData: clipboard(text),
                preventDefault,
            } as unknown as ClipboardEvent;

            component.onDigitsPaste(event);
            return preventDefault;
        };

        it("keeps every digit when a spaced card number is longer than maxlength", () => {
            const component = build();
            const input = field("cardNumber", 19);
            // 23 characters, 19 digits. maxlength 19 would keep "4242 4242 4242 4242" (16 digits).
            const preventDefault = paste(component, input, "4242 4242 4242 4242 424");

            expect(preventDefault).toHaveBeenCalled();
            expect(component.cardData.cardNumber).toBe("4242424242424242424");
            expect(input.value).toBe("4242424242424242424");
        });

        it("strips spaces from a pasted test card number", () => {
            const component = build();
            const input = field("cardNumber", 19);

            paste(component, input, "4242 4242 4242 4242");

            expect(component.cardData.cardNumber).toBe("4242424242424242");
            expect(input.value).toBe("4242424242424242");
        });

        it("strips dashes from a pasted test card number", () => {
            const component = build();
            const input = field("cardNumber", 19);

            paste(component, input, "4242-4242-4242-4242");

            expect(component.cardData.cardNumber).toBe("4242424242424242");
            expect(input.value).toBe("4242424242424242");
        });

        it("strips letters before applying the card number limit", () => {
            const component = build();
            const input = field("cardNumber", 19);
            // First 19 characters contain 14 digits; the last two digits sit past maxlength.
            paste(component, input, "4242 42xx 4242 4242 99");

            expect(component.cardData.cardNumber).toBe("4242424242424299");
            expect(input.value).toBe("4242424242424299");
        });

        it("strips a slash from a pasted expiry so both digits of the year survive", () => {
            const component = build();
            const input = field("expiryYear", 4);

            paste(component, input, "12/28");

            expect(component.cardData.expiryYear).toBe("1228");
            expect(input.value).toBe("1228");
        });

        it("strips slashes and letters from expiry before the 4 digit limit", () => {
            const component = build();
            const input = field("expiryYear", 4);

            paste(component, input, "12ab/28");

            expect(component.cardData.expiryYear).toBe("1228");
            expect(input.value).toBe("1228");
        });

        it("strips dashes, slashes, spaces and letters from a pasted CVV, then limits to 4", () => {
            const component = build();
            const input = field("cvv", 4);
            input.type = "password";

            paste(component, input, "1a2-3/4 5");

            expect(component.cardData.cvv).toBe("1234");
            expect(input.value).toBe("1234");
        });

        it("replaces the current selection and leaves the caret after the inserted digits", () => {
            const component = build();
            const input = field("cardNumber", 19, "4111111111111111");
            input.setSelectionRange(4, 8);
            paste(component, input, "99-99");

            expect(component.cardData.cardNumber).toBe("4111999911111111");
            expect(input.value).toBe("4111999911111111");
            expect(input.selectionStart).toBe(8);
            expect(input.selectionEnd).toBe(8);
        });

        it("does not insert the same paste twice when beforeinput follows the paste event", () => {
            const component = build();
            const input = field("cardNumber", 19);

            paste(component, input, "1111");
            const preventDefault = jasmine.createSpy("preventDefault");
            component.onDigitsBeforeInput({
                inputType: "insertFromPaste",
                data: "1111",
                target: input,
                preventDefault,
            } as unknown as InputEvent);

            expect(preventDefault).toHaveBeenCalled();
            expect(input.value).toBe("1111");
            expect(component.cardData.cardNumber).toBe("1111");
        });

        it("sanitizes a drop through beforeinput when the paste event did not run", () => {
            const component = build();
            const input = field("expiryYear", 4);
            const preventDefault = jasmine.createSpy("preventDefault");

            component.onDigitsBeforeInput({
                inputType: "insertFromDrop",
                data: "12/28",
                target: input,
                preventDefault,
            } as unknown as InputEvent);

            expect(preventDefault).toHaveBeenCalled();
            expect(component.cardData.expiryYear).toBe("1228");
            expect(input.value).toBe("1228");
        });

        it("keeps typed digits and still blocks a typed letter", () => {
            const component = build();
            const input = field("cvv", 4, "12");
            input.setSelectionRange(2, 2);

            const digitPrevent = jasmine.createSpy("preventDefault");
            component.onDigitsBeforeInput({
                inputType: "insertText",
                data: "3",
                target: input,
                preventDefault: digitPrevent,
            } as unknown as InputEvent);

            const letterPrevent = jasmine.createSpy("preventDefault");
            component.onDigitsBeforeInput({
                inputType: "insertText",
                data: "a",
                target: input,
                preventDefault: letterPrevent,
            } as unknown as InputEvent);

            expect(digitPrevent).not.toHaveBeenCalled();
            expect(letterPrevent).toHaveBeenCalled();
            expect(component.cardData.cvv).toBe("");
            expect(input.value).toBe("12");
        });
    });
});
