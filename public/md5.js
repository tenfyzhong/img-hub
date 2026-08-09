const SHIFT_AMOUNTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const CONSTANTS = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
));

function rotateLeft(value, amount) {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function wordHex(value) {
    let result = "";
    for (let index = 0; index < 4; index += 1) {
        result += ((value >>> (index * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return result;
}

class Md5 {
    constructor() {
        this.state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
        this.buffer = new Uint8Array(0);
        this.length = 0;
    }

    process(block) {
        const words = new Uint32Array(16);
        for (let index = 0; index < 16; index += 1) {
            const offset = index * 4;
            words[index] = (
                block[offset]
                | (block[offset + 1] << 8)
                | (block[offset + 2] << 16)
                | (block[offset + 3] << 24)
            ) >>> 0;
        }
        let [a, b, c, d] = this.state;
        for (let index = 0; index < 64; index += 1) {
            let mixed;
            let wordIndex;
            if (index < 16) {
                mixed = (b & c) | (~b & d);
                wordIndex = index;
            } else if (index < 32) {
                mixed = (d & b) | (~d & c);
                wordIndex = (5 * index + 1) % 16;
            } else if (index < 48) {
                mixed = b ^ c ^ d;
                wordIndex = (3 * index + 5) % 16;
            } else {
                mixed = c ^ (b | ~d);
                wordIndex = (7 * index) % 16;
            }
            const previousD = d;
            d = c;
            c = b;
            const sum = (a + mixed + CONSTANTS[index] + words[wordIndex]) >>> 0;
            b = (b + rotateLeft(sum, SHIFT_AMOUNTS[index])) >>> 0;
            a = previousD;
        }
        this.state[0] = (this.state[0] + a) >>> 0;
        this.state[1] = (this.state[1] + b) >>> 0;
        this.state[2] = (this.state[2] + c) >>> 0;
        this.state[3] = (this.state[3] + d) >>> 0;
    }

    update(bytes) {
        const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this.length += input.byteLength;
        const combined = new Uint8Array(this.buffer.byteLength + input.byteLength);
        combined.set(this.buffer);
        combined.set(input, this.buffer.byteLength);
        let offset = 0;
        while (offset + 64 <= combined.byteLength) {
            this.process(combined.subarray(offset, offset + 64));
            offset += 64;
        }
        this.buffer = combined.slice(offset);
    }

    digest() {
        const paddingLength = (56 - ((this.length + 1) % 64) + 64) % 64;
        const finalBlock = new Uint8Array(this.buffer.byteLength + 1 + paddingLength + 8);
        finalBlock.set(this.buffer);
        finalBlock[this.buffer.byteLength] = 0x80;
        const bitLengthLow = (this.length * 8) >>> 0;
        const bitLengthHigh = Math.floor(this.length / 0x20000000) >>> 0;
        const view = new DataView(finalBlock.buffer);
        view.setUint32(finalBlock.byteLength - 8, bitLengthLow, true);
        view.setUint32(finalBlock.byteLength - 4, bitLengthHigh, true);
        for (let offset = 0; offset < finalBlock.byteLength; offset += 64) {
            this.process(finalBlock.subarray(offset, offset + 64));
        }
        return this.state.map(wordHex).join("");
    }
}

export async function md5File(file, onProgress = () => {}, chunkSize = 2 * 1024 * 1024) {
    if (!file || typeof file.slice !== "function" || !Number.isFinite(file.size)) {
        throw new TypeError("A Blob or File is required");
    }
    const size = Number(file.size);
    const hasher = new Md5();
    if (size === 0) {
        onProgress(1);
        return hasher.digest();
    }
    const safeChunkSize = Math.max(1, Number(chunkSize) || 1);
    for (let offset = 0; offset < size; offset += safeChunkSize) {
        const chunk = file.slice(offset, Math.min(size, offset + safeChunkSize));
        hasher.update(new Uint8Array(await chunk.arrayBuffer()));
        onProgress(Math.min(1, (offset + chunk.size) / size));
    }
    return hasher.digest();
}
