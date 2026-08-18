export const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHIJKLMNPQRSTUVWXYZ";

const BASE = 60n;

/**
 * Encodes a non-negative integer or BigInt into a Base60 string.
 *
 * @param {number|bigint} num
 * @returns {string}
 */
export function encode(num) {
    let n = typeof num === "bigint" ? num : BigInt(Math.trunc(Number(num)));
    if (n <= 0n) {
        return "0";
    }

    let result = "";
    while (n > 0n) {
        const rem = Number(n % BASE);
        result = ALPHABET[rem] + result;
        n /= BASE;
    }
    return result;
}

/**
 * Decodes a Base60 string back to a numeric integer.
 * Returns NaN if input is invalid or contains characters not in ALPHABET.
 *
 * @param {string} str
 * @returns {number}
 */
export function decode(str) {
    if (typeof str !== "string" || str.length === 0) {
        return Number.NaN;
    }

    let result = 0;
    for (let i = 0; i < str.length; i += 1) {
        const idx = ALPHABET.indexOf(str[i]);
        if (idx === -1) {
            return Number.NaN;
        }
        result = result * 60 + idx;
    }
    return result;
}

/**
 * Generates a cryptographically random Base60 string of specified length.
 * Discards bytes >= 240 to prevent modulo bias (240 is 4 * 60).
 *
 * @param {number} [length=6]
 * @returns {string}
 */
export function randomBase60(length = 6) {
    let result = "";
    while (result.length < length) {
        const needed = length - result.length;
        const bytes = new Uint8Array(Math.max(needed * 2, 16));
        crypto.getRandomValues(bytes);
        for (let i = 0; i < bytes.length && result.length < length; i += 1) {
            const byte = bytes[i];
            if (byte < 240) {
                result += ALPHABET[byte % 60];
            }
        }
    }
    return result;
}
