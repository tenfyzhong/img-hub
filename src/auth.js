import { AppError } from "./errors.js";

const encoder = new TextEncoder();
const PASSWORD_ALGORITHM = "PBKDF2";
const PASSWORD_DIGEST = "SHA-256";
const PASSWORD_ITERATIONS = 100000;

function encodeBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(password, salt, iterations) {
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        PASSWORD_ALGORITHM,
        false,
        ["deriveBits"],
    );
    return new Uint8Array(await crypto.subtle.deriveBits({
        name: PASSWORD_ALGORITHM,
        hash: PASSWORD_DIGEST,
        salt,
        iterations,
    }, key, 256));
}

function constantTimeEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

export function validatePassword(password) {
    if (typeof password !== "string" || password.length < 10) {
        throw new AppError(400, "Password must be at least 10 characters long", "invalid_password");
    }
    if (password.length > 256) {
        throw new AppError(400, "Password must be no more than 256 characters long", "invalid_password");
    }
}

export function assertPasswordConfirmation(password, confirmation) {
    if (typeof confirmation !== "string" || password !== confirmation) {
        throw new AppError(400, "Password confirmation does not match", "password_confirmation_mismatch");
    }
}

export async function hashPassword(password) {
    validatePassword(password);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS);
    return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(derived)}`;
}

export async function verifyPassword(password, encoded) {
    try {
        const [algorithm, rawIterations, rawSalt, rawExpected] = encoded.split("$");
        if (algorithm !== "pbkdf2-sha256") {
            return false;
        }
        const iterations = Number.parseInt(rawIterations, 10);
        if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000) {
            return false;
        }
        const expected = decodeBase64Url(rawExpected);
        const actual = await derivePassword(password, decodeBase64Url(rawSalt), iterations);
        return constantTimeEqual(actual, expected);
    } catch {
        return false;
    }
}

export async function hashSessionToken(token) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    return encodeBase64Url(new Uint8Array(digest));
}

export function createSessionToken() {
    return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
