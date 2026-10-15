import {
    isCardHolderNameValidationError,
    isValidCardHolderName,
    normalizeCardHolderName,
    sanitizeCardHolderName,
} from "./card-holder-name";

describe("card holder name (#574)", () => {
    const accepted = ["Andrés Londoño", "María José Pérez", "O'Brien", "O\u2019Brien", "Jean-Luc", "Ana M. Pérez", "Müller", "Col\u00B7lell", "ジョン・スミス", "Иван Петров", "王小明", "محمد", "Jose\u0301"];
    accepted.forEach((n) => it(`accepts ${n}`, () => expect(isValidCardHolderName(n)).toBeTrue()));

    ["Andres123", "123456", "Maria@Perez", "-", ".", "   ", "", "Ana 😀", "A".repeat(51)].forEach((n) =>
        it(`rejects ${JSON.stringify(n)}`, () => expect(isValidCardHolderName(n)).toBeFalse())
    );

    it("strips digits/symbols and flags them", () => {
        expect(sanitizeCardHolderName("Andres123")).toEqual({ value: "Andres", rejected: true });
        expect(sanitizeCardHolderName("Maria@Perez")).toEqual({ value: "MariaPerez", rejected: true });
    });

    it("collapses spaces without flagging", () => {
        expect(sanitizeCardHolderName("  Ana \t  Maria ")).toEqual({ value: "Ana Maria ", rejected: false });
        expect(normalizeCardHolderName("Ana  Maria ")).toBe("Ana Maria");
    });

    it("maps a backend 409 on cardName", () => {
        expect(isCardHolderNameValidationError({ status: 409, error: { validationError: '"cardName" with value "x1" fails' } })).toBeTrue();
        expect(isCardHolderNameValidationError({ status: 409, error: { validationError: "Credit card has expired" } })).toBeFalse();
    });
});
