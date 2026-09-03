// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { SetSchedulingStatesRequest } from "@generated/anki/frontend_pb";
import { Bool, Empty } from "@generated/anki/generic_pb";
import { SchedulingStates } from "@generated/anki/scheduler_pb";
import { describe, expect, it } from "vitest";

import { dispatchFrontendCall, hasFrontendHandler, registerFrontendHandler, typedHandler } from "./frontend-service";

const frame = {} as Window;

describe("frontend service", () => {
    it("rejects methods nobody registered", async () => {
        await expect(dispatchFrontendCall("openCardsDialog", new Uint8Array(), frame)).rejects.toThrow(
            /openCardsDialog/,
        );
    });

    it("decodes the request and encodes the response", async () => {
        let seenKey = "";
        const unregister = registerFrontendHandler(
            "setSchedulingStates",
            typedHandler(SetSchedulingStatesRequest, (input) => {
                seenKey = input.key;
                return new Empty();
            }),
        );
        const request = new SetSchedulingStatesRequest({ key: "k1", states: new SchedulingStates() });
        const out = await dispatchFrontendCall("setSchedulingStates", request.toBinary(), frame);
        expect(seenKey).toBe("k1");
        expect(out).toEqual(new Empty().toBinary());
        unregister();
        expect(hasFrontendHandler("setSchedulingStates")).toBe(false);
    });

    it("passes bytes through untouched for raw handlers and unregisters only its own handler", async () => {
        const first = registerFrontendHandler("askUser", () => new Bool({ val: true }).toBinary());
        const second = registerFrontendHandler("askUser", () => new Bool({ val: false }).toBinary());
        first();
        expect(hasFrontendHandler("askUser")).toBe(true);
        const out = await dispatchFrontendCall("askUser", new Uint8Array([1, 2]), frame);
        expect(Bool.fromBinary(out).val).toBe(false);
        second();
    });
});
