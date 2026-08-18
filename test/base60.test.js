import assert from "node:assert/strict";
import test from "node:test";

import {
    ALPHABET,
    decode,
    encode,
    randomBase60,
} from "../src/base60.js";

test("ALPHABET has length 60 and excludes 'l' and 'O'", () => {
    assert.equal(ALPHABET.length, 60);
    assert.equal(ALPHABET, "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHIJKLMNPQRSTUVWXYZ");
    assert.equal(ALPHABET.includes("l"), false);
    assert.equal(ALPHABET.includes("O"), false);
});

test("encodes numbers into Base60 correctly", () => {
    assert.equal(encode(0), "0");
    assert.equal(encode(1), "1");
    assert.equal(encode(9), "9");
    assert.equal(encode(10), "a");
    assert.equal(encode(59), "Z");
    assert.equal(encode(60), "10");
    assert.equal(encode(1754481600000), "CBgF000");
    assert.equal(encode(1754481600000n), "CBgF000");
});

test("decodes Base60 strings into numbers correctly", () => {
    assert.equal(decode("0"), 0);
    assert.equal(decode("1"), 1);
    assert.equal(decode("9"), 9);
    assert.equal(decode("a"), 10);
    assert.equal(decode("Z"), 59);
    assert.equal(decode("10"), 60);
    assert.equal(decode("CBgF000"), 1754481600000);
});

test("decode returns NaN for invalid input", () => {
    assert.ok(Number.isNaN(decode("")));
    assert.ok(Number.isNaN(decode("hello-world")));
    assert.ok(Number.isNaN(decode("l"))); // contains excluded 'l'
    assert.ok(Number.isNaN(decode("O"))); // contains excluded 'O'
    assert.ok(Number.isNaN(decode(null)));
    assert.ok(Number.isNaN(decode(undefined)));
});

test("encodes and decodes round-trip", () => {
    const values = [0, 1, 42, 60, 3599, 3600, 1754481600000, 9007199254740991];
    for (const val of values) {
        assert.equal(decode(encode(val)), val);
    }
});

test("randomBase60 generates strings of requested length with valid Base60 characters", () => {
    for (let len = 1; len <= 12; len++) {
        const str = randomBase60(len);
        assert.equal(str.length, len);
        for (const ch of str) {
            assert.ok(ALPHABET.includes(ch), `Character ${ch} should be in ALPHABET`);
        }
    }
    const id = randomBase60(6);
    assert.equal(id.length, 6);
    assert.match(id, /^[0-9a-km-zA-NP-Z]{6}$/);
});
