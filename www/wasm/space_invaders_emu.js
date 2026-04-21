/* @ts-self-types="./space_invaders_emu.d.ts" */

export class WasmMachine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMachineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmachine_free(ptr, 0);
    }
    /**
     * Acknowledge sound state (call after processing audio).
     */
    acknowledgeSounds() {
        wasm.wasmmachine_acknowledgeSounds(this.__wbg_ptr);
    }
    /**
     * Decay heat values (call once per frame for glow persistence).
     */
    decayHeat() {
        wasm.wasmmachine_decayHeat(this.__wbg_ptr);
    }
    /**
     * Execute one full frame (~33,333 CPU cycles, 2 interrupts).
     * Returns cycles executed.
     * @returns {number}
     */
    executeFrame() {
        const ret = wasm.wasmmachine_executeFrame(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get total CPU cycles executed.
     * @returns {number}
     */
    getCycles() {
        const ret = wasm.wasmmachine_getCycles(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get execution heat map (16384 bytes — one per ROM/RAM/VRAM address).
     * @returns {Uint8Array}
     */
    getExecHeat() {
        const ret = wasm.wasmmachine_getExecHeat(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Get current program counter.
     * @returns {number}
     */
    getPC() {
        const ret = wasm.wasmmachine_getPC(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get previous sound port 3 (for edge-triggered sounds).
     * @returns {number}
     */
    getPrevSoundPort3() {
        const ret = wasm.wasmmachine_getPrevSoundPort3(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get previous sound port 5 (for edge-triggered sounds).
     * @returns {number}
     */
    getPrevSoundPort5() {
        const ret = wasm.wasmmachine_getPrevSoundPort5(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get CPU registers: [PC, SP, A, Flags, B, C, D, E, H, L].
     * @returns {Uint16Array}
     */
    getRegisters() {
        const ret = wasm.wasmmachine_getRegisters(this.__wbg_ptr);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
    /**
     * Get sound port 3 value (sound effects group 1).
     * @returns {number}
     */
    getSoundPort3() {
        const ret = wasm.wasmmachine_getSoundPort3(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get sound port 5 value (sound effects group 2).
     * @returns {number}
     */
    getSoundPort5() {
        const ret = wasm.wasmmachine_getSoundPort5(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get VRAM mutation heat map (7168 bytes).
     * @returns {Uint8Array}
     */
    getVramHeat() {
        const ret = wasm.wasmmachine_getVramHeat(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Check if a ROM is loaded.
     * @returns {boolean}
     */
    hasRom() {
        const ret = wasm.wasmmachine_hasRom(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Load ROM bytes into machine memory (up to 8KB).
     * @param {Uint8Array} rom
     */
    loadRom(rom) {
        const ptr0 = passArray8ToWasm0(rom, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmmachine_loadRom(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Create a new Space Invaders machine.
     */
    constructor() {
        const ret = wasm.wasmmachine_new();
        this.__wbg_ptr = ret >>> 0;
        WasmMachineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Read a raw machine memory byte.
     * @param {number} addr
     * @returns {number}
     */
    readByte(addr) {
        const ret = wasm.wasmmachine_readByte(this.__wbg_ptr, addr);
        return ret;
    }
    /**
     * Render VRAM into RGBA pixel buffer (224×256×4 bytes).
     * Ready for Canvas putImageData.
     * @returns {Uint8Array}
     */
    renderFrame() {
        const ret = wasm.wasmmachine_renderFrame(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Set player input port 1.
     *
     * Bit 0: Coin | Bit 1: 2P Start | Bit 2: 1P Start
     * Bit 4: Fire | Bit 5: Left | Bit 6: Right
     * @param {number} val
     */
    setInputPort1(val) {
        wasm.wasmmachine_setInputPort1(this.__wbg_ptr, val);
    }
    /**
     * Set input port 2 (player 2 + DIP switches).
     * @param {number} val
     */
    setInputPort2(val) {
        wasm.wasmmachine_setInputPort2(this.__wbg_ptr, val);
    }
    /**
     * Snapshot VRAM and compute mutation heat for this frame.
     */
    updateVramHeat() {
        wasm.wasmmachine_updateVramHeat(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WasmMachine.prototype[Symbol.dispose] = WasmMachine.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./space_invaders_emu_bg.js": import0,
    };
}

const WasmMachineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmachine_free(ptr >>> 0, 1));

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('space_invaders_emu_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
