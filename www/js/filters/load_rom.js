// LoadRom — CUP Filter
// Reads a ROM file (or multiple ROM chip files) into a Uint8Array.
// Payload in:  { files: FileList | File[] }
// Payload out: { rom: Uint8Array, romName: string }

export class LoadRom {
  async call(payload) {
    const files = payload.get('files');
    if (!files || files.length === 0) {
      throw new Error('No ROM file provided');
    }

    let rom;
    let romName;

    if (files.length === 1) {
      // Single ROM file (8KB combined)
      const file = files[0];
      romName = file.name;
      const buffer = await file.arrayBuffer();
      rom = new Uint8Array(buffer);
    } else {
      // Multiple ROM chip files (invaders.h, .g, .f, .e)
      // Sort by name descending to get correct order: h, g, f, e
      const sorted = Array.from(files).sort((a, b) => {
        const extA = a.name.split('.').pop().toLowerCase();
        const extB = b.name.split('.').pop().toLowerCase();
        return extB.localeCompare(extA);
      });

      romName = sorted.map(f => f.name).join(' + ');
      const buffers = await Promise.all(sorted.map(f => f.arrayBuffer()));
      const totalLen = buffers.reduce((sum, b) => sum + b.byteLength, 0);
      rom = new Uint8Array(totalLen);

      let offset = 0;
      for (const buf of buffers) {
        rom.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
    }

    // Validate ROM size (should be 2KB, 4KB, 6KB, or 8KB)
    if (rom.length < 2048 || rom.length > 8192) {
      throw new Error(
        `Invalid ROM size: ${rom.length} bytes. Expected 2048–8192 bytes.`
      );
    }

    // Cache ROM in IndexedDB for offline replay
    try {
      await cacheRom(romName, rom);
    } catch (_) {
      // Non-critical — continue without caching
    }

    return payload.insert('rom', rom).insert('romName', romName);
  }
}

/** Store ROM in IndexedDB for offline access. */
async function cacheRom(name, data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('space-invaders-roms', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('roms');
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('roms', 'readwrite');
      tx.objectStore('roms').put({ name, data: Array.from(data) }, 'last');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Load last-used ROM from IndexedDB. */
export async function loadCachedRom() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('space-invaders-roms', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('roms');
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('roms', 'readonly');
      const getReq = tx.objectStore('roms').get('last');
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve({
            name: getReq.result.name,
            data: new Uint8Array(getReq.result.data),
          });
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}
