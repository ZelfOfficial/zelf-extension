import { Pipe, type PipeTransform } from "@angular/core";

import { formatDisplayAmount, formatDisplayFiat, type DisplayAmountOptions } from "../core/utils/display-number.util";

/** `{{ token.amount | displayAmount }}`: at most 4 decimals, "<0.0001" for dust. Display only. */
@Pipe({ name: "displayAmount", standalone: true })
export class DisplayAmountPipe implements PipeTransform {
    transform(value: unknown, minDecimals = 0, rounding: DisplayAmountOptions["rounding"] = "round"): string {
        return formatDisplayAmount(value, { minDecimals, rounding });
    }
}

/** `{{ token.fiatBalance | displayFiat }}`: USD with 2–4 decimals, "<$0.0001" for dust. Display only. */
@Pipe({ name: "displayFiat", standalone: true })
export class DisplayFiatPipe implements PipeTransform {
    transform(value: unknown, minDecimals = 2): string {
        return formatDisplayFiat(value, { minDecimals });
    }
}
