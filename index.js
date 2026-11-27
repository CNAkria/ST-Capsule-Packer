// ============================================================================
// ST-Capsule-Packer v2.0.0 — All-in-One Card Native Multi-Worldbook & Preset
// - Embeds multi-worldbooks (1 primary + N extraBooks), bound OpenAI preset,
//   and scoped regexes directly inside a SINGLE Character Card (.charx / .png)
//   via card.data.extensions.st_capsule_manifest + st_capsule_bundle
// - Mandatory front prefix (e.g. 【AGY1128_01】) on card, all worldbooks, and
//   bound preset to guarantee zero collisions across versions
// - Auto-unpacks & binds all worldbooks (calling updateWorldInfoList + exact
//   strip-.png charLore key) when imported even via SillyTavern's NATIVE
//   "Import Character" button
// - Auto-switches to the card's bound preset on CHAT_CHANGED and restores the
//   user's previous normal preset when switching to other cards
// - Cascade-deletes ALL prefixed worldbooks and bound preset automatically on
//   CHARACTER_DELETED when the user deletes the character card
// - Includes 1-click Prefix/Suffix Batch Cleaner & Luker Android SAF Bridge
// ============================================================================

const EXT_ID = 'st-capsule-packer';
const BUNDLE_SPEC = 'st_card_bundle_v2';
const BUNDLE_PREFIX_MAGIC = 'STBND2:GZIP:';
const LEGACY_CAP_MAGIC_GZIP = 'STCAP1:GZIP:';
const LEGACY_CAP_MAGIC_RAW = 'STCAP1:RAW:';
const LS_LAST_NORMAL_PRESET = 'stcap_v2_last_normal_preset';

let cachedMods = null;
const installingAvatars = new Set();
const installedSessionSignatures = new Map(); // avatar -> manifest signature

// ============================================================================
// 0. Critical Inline CSS (Luker Top-Layer <dialog> Safe)
// ============================================================================
const CRITICAL_CSS = `
dialog.stcap-dialog {
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    max-width: 96vw !important;
    max-height: 92vh !important;
    width: 840px !important;
    margin: auto !important;
    overflow: visible !important;
    color: #f1f5f9 !important;
    z-index: 2147483640 !important;
}
dialog.stcap-dialog::backdrop {
    background: rgba(4, 6, 14, 0.80) !important;
    backdrop-filter: blur(6px) !important;
    -webkit-backdrop-filter: blur(6px) !important;
}
.stcap-overlay-fallback {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483640 !important;
    background: rgba(4, 6, 14, 0.82) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 10px !important;
}
.stcap-modal {
    width: 100% !important;
    max-height: 90vh !important;
    display: flex !important;
    flex-direction: column !important;
    background: rgba(16, 19, 28, 0.98) !important;
    border: 1px solid rgba(192, 132, 252, 0.45) !important;
    border-radius: 14px !important;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.88), 0 0 22px rgba(168, 85, 247, 0.25) !important;
    color: #f1f5f9 !important;
    overflow: hidden !important;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif !important;
    box-sizing: border-box !important;
}
.stcap-hazard-bar {
    height: 6px !important;
    width: 100% !important;
    flex-shrink: 0 !important;
    background: repeating-linear-gradient(-45deg, #facc15 0px, #facc15 12px, #111827 12px, #111827 24px) !important;
}
.stcap-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 12px 16px !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
    background: rgba(255, 255, 255, 0.03) !important;
    flex-shrink: 0 !important;
}
.stcap-title-wrap {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
}
.stcap-title {
    font-size: 16px !important;
    font-weight: 700 !important;
    color: #ffffff !important;
    text-shadow: 0 0 10px rgba(192, 132, 252, 0.65) !important;
}
.stcap-neon-tag {
    font-size: 11px !important;
    padding: 2px 8px !important;
    border-radius: 999px !important;
    background: rgba(74, 222, 128, 0.14) !important;
    border: 1px solid rgba(74, 222, 128, 0.45) !important;
    color: #4ade80 !important;
    font-weight: 600 !important;
}
.stcap-close {
    cursor: pointer !important;
    background: rgba(255, 255, 255, 0.08) !important;
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    color: #f1f5f9 !important;
    width: 32px !important;
    height: 32px !important;
    border-radius: 8px !important;
    font-size: 16px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
}
.stcap-tabs {
    display: flex !important;
    gap: 6px !important;
    padding: 8px 14px 0 !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
    flex-shrink: 0 !important;
    overflow-x: auto !important;
}
.stcap-tab {
    padding: 8px 12px !important;
    border-radius: 8px 8px 0 0 !important;
    cursor: pointer !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #94a3b8 !important;
    background: transparent !important;
    border: 1px solid transparent !important;
    border-bottom: none !important;
    white-space: nowrap !important;
}
.stcap-tab.active {
    color: #f8fafc !important;
    background: rgba(168, 85, 247, 0.18) !important;
    border-color: rgba(192, 132, 252, 0.4) !important;
}
.stcap-body {
    padding: 14px 16px !important;
    overflow-y: auto !important;
    flex: 1 1 auto !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    -webkit-overflow-scrolling: touch !important;
}
.stcap-char-banner {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    padding: 10px 12px !important;
    border-radius: 10px !important;
    background: linear-gradient(90deg, rgba(168, 85, 247, 0.16), rgba(59, 130, 246, 0.10)) !important;
    border: 1px solid rgba(192, 132, 252, 0.3) !important;
}
.stcap-char-banner img {
    width: 48px !important;
    height: 48px !important;
    border-radius: 8px !important;
    object-fit: cover !important;
    border: 1px solid rgba(255, 255, 255, 0.25) !important;
    flex-shrink: 0 !important;
}
.stcap-char-meta { min-width: 0 !important; flex: 1 !important; }
.stcap-char-name {
    font-size: 14px !important;
    font-weight: 700 !important;
    color: #fff !important;
    word-break: break-all !important;
}
.stcap-char-sub { font-size: 12px !important; color: #cbd5e1 !important; margin-top: 2px !important; }
.stcap-grid {
    display: grid !important;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
    gap: 10px !important;
}
.stcap-section {
    background: rgba(255, 255, 255, 0.035) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 10px !important;
    padding: 10px 12px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 7px !important;
}
.stcap-section-head {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 6px !important;
    flex-wrap: wrap !important;
}
.stcap-section-title { font-size: 13px !important; font-weight: 700 !important; color: #e2e8f0 !important; }
.stcap-mini-actions { display: flex !important; gap: 5px !important; }
.stcap-mini-btn {
    font-size: 11px !important;
    padding: 2px 8px !important;
    border-radius: 5px !important;
    cursor: pointer !important;
    background: rgba(255, 255, 255, 0.08) !important;
    border: 1px solid rgba(255, 255, 255, 0.16) !important;
    color: #cbd5e1 !important;
}
.stcap-search {
    width: 100% !important;
    padding: 6px 9px !important;
    border-radius: 6px !important;
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    background: rgba(0, 0, 0, 0.35) !important;
    color: #f8fafc !important;
    font-size: 12px !important;
    box-sizing: border-box !important;
}
.stcap-list {
    max-height: 175px !important;
    overflow-y: auto !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 3px !important;
}
.stcap-item {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 5px 7px !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    font-size: 12px !important;
    color: #e2e8f0 !important;
}
.stcap-item:hover { background: rgba(255, 255, 255, 0.06) !important; }
.stcap-item input[type="checkbox"], .stcap-item input[type="radio"] {
    accent-color: #a855f7 !important;
    width: 16px !important;
    height: 16px !important;
    flex-shrink: 0 !important;
}
.stcap-item-label {
    flex: 1 !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
}
.stcap-item-sub {
    font-size: 10px !important;
    color: #c084fc !important;
    padding: 1px 6px !important;
    border-radius: 4px !important;
    background: rgba(168, 85, 247, 0.16) !important;
    flex-shrink: 0 !important;
}
.stcap-footer {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 10px 14px !important;
    border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
    background: rgba(0, 0, 0, 0.35) !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    flex-shrink: 0 !important;
}
.stcap-status { font-size: 12px !important; color: #93c5fd !important; flex: 1 1 200px !important; }
.stcap-primary-btn {
    padding: 8px 14px !important;
    border-radius: 8px !important;
    border: 1px solid rgba(192, 132, 252, 0.6) !important;
    background: linear-gradient(135deg, #7e22ce, #4f46e5) !important;
    color: #fff !important;
    font-weight: 700 !important;
    font-size: 12px !important;
    cursor: pointer !important;
}
.stcap-primary-btn:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
.stcap-secondary-btn {
    padding: 8px 12px !important;
    border-radius: 8px !important;
    border: 1px solid rgba(255, 255, 255, 0.22) !important;
    background: rgba(255, 255, 255, 0.08) !important;
    color: #f1f5f9 !important;
    font-weight: 600 !important;
    font-size: 12px !important;
    cursor: pointer !important;
}
.stcap-danger-btn {
    padding: 6px 12px !important;
    border-radius: 7px !important;
    border: 1px solid rgba(248, 113, 113, 0.55) !important;
    background: rgba(220, 38, 38, 0.22) !important;
    color: #fca5a5 !important;
    font-weight: 700 !important;
    font-size: 12px !important;
    cursor: pointer !important;
}
.stcap-dropzone {
    border: 2px dashed rgba(192, 132, 252, 0.45) !important;
    border-radius: 10px !important;
    padding: 18px !important;
    text-align: center !important;
    cursor: pointer !important;
    background: rgba(168, 85, 247, 0.06) !important;
}
.stcap-drawer-box { display: flex; flex-direction: column; gap: 8px; padding: 8px 4px; font-size: 12px; }
.stcap-btn-row { display: flex; flex-wrap: wrap; gap: 8px; }
.stcap-trigger-btn {
    flex: 1 1 130px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(192, 132, 252, 0.45);
    background: linear-gradient(135deg, rgba(88, 28, 135, 0.55), rgba(30, 41, 59, 0.85));
    color: #f8fafc;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
}
`;

function ensureCriticalStyles() {
    if (!document.getElementById('stcap-critical-inline-css')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'stcap-critical-inline-css';
        styleEl.textContent = CRITICAL_CSS;
        document.head.appendChild(styleEl);
    }
}

// ============================================================================
// 1. Prefix Normalization & Stripping Utilities
// ============================================================================
const FRONT_PREFIX_RE = /^(?:【[^】]{1,32}】|\[[^\]]{1,32}\])\s*/;
const TAIL_SUFFIX_RE = /\s*(?:【[^】]{1,32}】|\[AGY[^\]]*\]|\[ST[^\]]*\])$/i;

function stripAnyBundleAffixes(rawName) {
    return String(rawName || '')
        .replace(FRONT_PREFIX_RE, '')
        .replace(TAIL_SUFFIX_RE, '')
        .trim();
}

function normalizeFrontPrefix(rawPrefix) {
    const trimmed = String(rawPrefix || '').trim();
    if (!trimmed) return makeFreshPrefix();
    if ((trimmed.startsWith('【') && trimmed.endsWith('】')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        return trimmed;
    }
    return `【${trimmed.replace(/[【】\[\]<>:"/\\|?*]/g, '')}】`;
}

function applyFrontPrefix(prefix, rawName) {
    const cleanPfx = normalizeFrontPrefix(prefix);
    const base = stripAnyBundleAffixes(rawName) || 'Unnamed';
    return `${cleanPfx}${base}`;
}

function makeFreshPrefix(tag = 'ST') {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `【${tag}${mm}${dd}_${hh}${mi}${ss}】`;
}

function extractLeadingPrefix(name) {
    const m = String(name || '').match(/^(【[^】]{1,32}】|\[[^\]]{1,32}\])/);
    return m ? m[1] : '';
}

function extractTrailingTag(name) {
    const m = String(name || '').match(/\s*(\[(?:AGY|ST)[^\]]+\])$/i);
    return m ? m[1] : '';
}

function getCharKeyWithoutExt(avatarOrName) {
    return String(avatarOrName || '').replace(/\.[^/.]+$/, '');
}

// ============================================================================
// 2. Binary, CRC32, GZIP, PNG Chunks & Pure-JS ZIP (.charx) Builder/Reader
// ============================================================================
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function uint8ToBase64(u8) {
    const CHUNK = 0x8000;
    const parts = [];
    for (let i = 0; i < u8.length; i += CHUNK) {
        parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
}

function base64ToUint8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function utf8ToBase64(str) {
    return uint8ToBase64(new TextEncoder().encode(str));
}

function base64ToUtf8(b64) {
    return new TextDecoder('utf-8').decode(base64ToUint8(b64));
}

async function gzipStringToBase64(str) {
    const raw = new TextEncoder().encode(str);
    if (typeof CompressionStream !== 'undefined') {
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(raw);
        writer.close();
        const compressedBuf = await new Response(cs.readable).arrayBuffer();
        return BUNDLE_PREFIX_MAGIC + uint8ToBase64(new Uint8Array(compressedBuf));
    }
    return 'STBND2:RAW:' + uint8ToBase64(raw);
}

async function decodeBundlePayload(encodedStr) {
    if (!encodedStr || typeof encodedStr !== 'string') throw new Error('空数据包');
    if (encodedStr.startsWith(BUNDLE_PREFIX_MAGIC) || encodedStr.startsWith(LEGACY_CAP_MAGIC_GZIP)) {
        const pfxLen = encodedStr.startsWith(BUNDLE_PREFIX_MAGIC) ? BUNDLE_PREFIX_MAGIC.length : LEGACY_CAP_MAGIC_GZIP.length;
        const compBytes = base64ToUint8(encodedStr.slice(pfxLen));
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(compBytes);
        writer.close();
        const decompBuf = await new Response(ds.readable).arrayBuffer();
        return JSON.parse(new TextDecoder('utf-8').decode(decompBuf));
    }
    if (encodedStr.startsWith('STBND2:RAW:') || encodedStr.startsWith(LEGACY_CAP_MAGIC_RAW)) {
        const idx = encodedStr.indexOf(':', 7) + 1;
        return JSON.parse(base64ToUtf8(encodedStr.slice(idx)));
    }
    return JSON.parse(base64ToUtf8(encodedStr));
}

function isPngBytes(u8) {
    if (!u8 || u8.length < 8) return false;
    for (let i = 0; i < 8; i++) if (u8[i] !== PNG_SIGNATURE[i]) return false;
    return true;
}

function isZipBytes(u8) {
    return Boolean(u8 && u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04);
}

function extractPngChunks(u8) {
    if (!isPngBytes(u8)) throw new Error('不是合法的 PNG 文件');
    const chunks = [];
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let offset = 8;
    while (offset + 8 <= u8.length) {
        const length = view.getUint32(offset, false);
        const name = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > u8.length) break;
        chunks.push({ name, data: u8.slice(dataStart, dataEnd) });
        offset = dataEnd + 4;
        if (name === 'IEND') break;
    }
    return chunks;
}

function decodeTextChunk(data) {
    let nulIdx = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) { nulIdx = i; break; }
    }
    if (nulIdx < 0) return null;
    const keyword = new TextDecoder('latin1').decode(data.subarray(0, nulIdx));
    const text = new TextDecoder('latin1').decode(data.subarray(nulIdx + 1));
    return { keyword, text };
}

function makeTextChunk(keyword, asciiText) {
    const keyBytes = new TextEncoder().encode(keyword);
    const valBytes = new TextEncoder().encode(asciiText);
    const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
    data.set(keyBytes, 0);
    data[keyBytes.length] = 0;
    data.set(valBytes, keyBytes.length + 1);
    return { name: 'tEXt', data };
}

function encodePngChunks(chunks) {
    let total = 8;
    for (const c of chunks) total += 12 + c.data.length;
    const out = new Uint8Array(total);
    out.set(PNG_SIGNATURE, 0);
    const view = new DataView(out.buffer);
    let offset = 8;
    for (const c of chunks) {
        const len = c.data.length;
        view.setUint32(offset, len, false);
        for (let i = 0; i < 4; i++) out[offset + 4 + i] = c.name.charCodeAt(i);
        out.set(c.data, offset + 8);
        const crcVal = crc32(out.subarray(offset + 4, offset + 8 + len));
        view.setUint32(offset + 8 + len, crcVal, false);
        offset += 12 + len;
    }
    return out;
}

function buildCleanCardPngBytes(rawPngBytes, v2CardObj) {
    const chunks = extractPngChunks(rawPngBytes).filter(ch => {
        if (ch.name !== 'tEXt' && ch.name !== 'zTXt' && ch.name !== 'iTXt') return true;
        if (ch.name === 'tEXt') {
            const dec = decodeTextChunk(ch.data);
            return !dec || !['chara', 'ccv3', 'st_capsule'].includes(dec.keyword.toLowerCase());
        }
        return false;
    });
    const v2Str = JSON.stringify(v2CardObj);
    const v3Obj = JSON.parse(v2Str);
    v3Obj.spec = 'chara_card_v3';
    v3Obj.spec_version = '3.0';
    const v3Str = JSON.stringify(v3Obj);
    const iend = chunks.findIndex(c => c.name === 'IEND');
    chunks.splice(
        iend >= 0 ? iend : chunks.length,
        0,
        makeTextChunk('chara', utf8ToBase64(v2Str)),
        makeTextChunk('ccv3', utf8ToBase64(v3Str)),
    );
    return encodePngChunks(chunks);
}

function stripPngToPureImage(rawPngBytes) {
    const chunks = extractPngChunks(rawPngBytes).filter(ch => ch.name !== 'tEXt' && ch.name !== 'zTXt' && ch.name !== 'iTXt');
    return encodePngChunks(chunks);
}

// Pure-JS STORE ZIP Builder for .charx (100% compatible with SillyTavern CharXParser)
function buildStoreZipBytes(entries) {
    // entries: [{ path: string, data: Uint8Array }]
    const enc = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = enc.encode(entry.path);
        const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
        const crc = crc32(data);

        const localHdr = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHdr.buffer);
        lv.setUint32(0, ZIP_LOCAL_SIG, true);
        lv.setUint16(4, 20, true);      // version needed
        lv.setUint16(6, 0x0800, true);  // UTF-8 flag
        lv.setUint16(8, 0, true);       // method 0 = STORE
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0x21, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHdr.set(nameBytes, 30);

        const centralHdr = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHdr.buffer);
        cv.setUint32(0, ZIP_CENTRAL_SIG, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        centralHdr.set(nameBytes, 46);

        localParts.push(localHdr, data);
        centralParts.push(centralHdr);
        offset += localHdr.length + data.length;
    }

    let centralSize = 0;
    for (const c of centralParts) centralSize += c.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, ZIP_EOCD_SIG, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const out = new Uint8Array(offset + centralSize + 22);
    let pos = 0;
    for (const p of localParts) { out.set(p, pos); pos += p.length; }
    for (const p of centralParts) { out.set(p, pos); pos += p.length; }
    out.set(eocd, pos);
    return out;
}

async function readFilesFromZipBytes(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const files = new Map();
    let eocdPos = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
        if (view.getUint32(i, true) === ZIP_EOCD_SIG) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new Error('无效的 CharX / ZIP 文件结构');
    const totalEntries = view.getUint16(eocdPos + 10, true);
    let cdPos = view.getUint32(eocdPos + 16, true);
    const dec = new TextDecoder('utf-8');

    for (let idx = 0; idx < totalEntries && cdPos + 46 <= u8.length; idx++) {
        if (view.getUint32(cdPos, true) !== ZIP_CENTRAL_SIG) break;
        const method = view.getUint16(cdPos + 10, true);
        const compSize = view.getUint32(cdPos + 20, true);
        const nameLen = view.getUint16(cdPos + 28, true);
        const extraLen = view.getUint16(cdPos + 30, true);
        const commentLen = view.getUint16(cdPos + 32, true);
        const localOffset = view.getUint32(cdPos + 42, true);
        const name = dec.decode(u8.subarray(cdPos + 46, cdPos + 46 + nameLen));
        cdPos += 46 + nameLen + extraLen + commentLen;

        if (localOffset + 30 > u8.length) continue;
        const lNameLen = view.getUint16(localOffset + 26, true);
        const lExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const rawSlice = u8.subarray(dataStart, dataStart + compSize);

        if (method === 0) {
            files.set(name, rawSlice);
        } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const w = ds.writable.getWriter();
            w.write(rawSlice);
            w.close();
            const ab = await new Response(ds.readable).arrayBuffer();
            files.set(name, new Uint8Array(ab));
        }
    }
    return files;
}

function buildCharXBytes(pureAvatarPngBytes, v2CardObj) {
    const v3Card = JSON.parse(JSON.stringify(v2CardObj));
    v3Card.spec = 'chara_card_v3';
    v3Card.spec_version = '3.0';
    v3Card.data = v3Card.data || {};
    v3Card.data.assets = [
        {
            type: 'icon',
            uri: 'embeded://assets/icon/main.png',
            name: 'main',
            ext: 'png',
        },
    ];
    const cardJsonBytes = new TextEncoder().encode(JSON.stringify(v3Card));
    return buildStoreZipBytes([
        { path: 'card.json', data: cardJsonBytes },
        { path: 'assets/icon/main.png', data: pureAvatarPngBytes },
    ]);
}

// ============================================================================
// 3. Embedded TavernHelper Fallback Script Builder (Dual-Engine Insurance)
// ============================================================================
function buildEmbeddedTavernHelperBootstrapScript(prefix) {
    // Runs inside TavernHelper's character script iframe if enabled; silently skips if
    // ST-Capsule-Packer v2.0 is already active in parent window, otherwise self-installs!
    const scriptCode = `
(async () => {
  try {
    const hostWin = window.parent || window;
    if (hostWin.__ST_CAPSULE_PACKER_V2_ACTIVE__) return;
    const ST = hostWin.SillyTavern;
    if (!ST || typeof ST.getContext !== 'function') return;
    const ctx = ST.getContext();
    const chid = ctx.characterId;
    if (chid === undefined || !ctx.characters?.[chid]) return;
    const charObj = ctx.characters[chid];
    const manifest = charObj?.data?.extensions?.st_capsule_manifest;
    const encoded = charObj?.data?.extensions?.st_capsule_bundle;
    if (!manifest || !encoded || manifest.spec !== '${BUNDLE_SPEC}') return;

    const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
    const setResp = await hostWin.fetch('/api/settings/get', { method: 'POST', headers, body: '{}' });
    const setJson = setResp.ok ? await setResp.json() : {};
    const existingWorlds = new Set(setJson.world_names || []);
    const missingBooks = (manifest.all_worldbooks || []).filter(n => !existingWorlds.has(n));
    const pm = typeof ctx.getPresetManager === 'function' ? ctx.getPresetManager('openai') : null;
    const hasPreset = !manifest.bound_preset?.name || Boolean(pm?.findPreset?.(manifest.bound_preset.name));
    if (missingBooks.length === 0 && hasPreset) return;

    const b64 = encoded.slice('${BUNDLE_PREFIX_MAGIC}'.length);
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(u8); w.close();
    const bundle = JSON.parse(new TextDecoder('utf-8').decode(await new Response(ds.readable).arrayBuffer()));

    for (const wb of (bundle.worldbooks || [])) {
      if (!wb?.name || !wb?.data) continue;
      await hostWin.fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: wb.name, data: wb.data }),
      });
    }
    if (bundle.preset?.name && bundle.preset?.data && pm?.savePreset) {
      await pm.savePreset(bundle.preset.name, bundle.preset.data);
      const pv = pm.findPreset(bundle.preset.name);
      if (pv !== undefined && pv !== null) pm.selectPreset(pv);
    }
    const charKey = String(charObj.avatar || '').replace(/\\.[^/.]+$/, '');
    if (ctx.worldInfo) {
      ctx.worldInfo.charLore = ctx.worldInfo.charLore || [];
      const idx = ctx.worldInfo.charLore.findIndex(e => e.name === charKey);
      const extra = manifest.extra_worldbooks || [];
      if (idx >= 0) ctx.worldInfo.charLore[idx].extraBooks = extra;
      else if (extra.length) ctx.worldInfo.charLore.push({ name: charKey, extraBooks: extra });
    }
    await ctx.saveSettings?.();
    if (hostWin.toastr) hostWin.toastr.success('已自动部署角色内置世界书与预设，刷新页面即可完全生效');
  } catch (e) {
    console.warn('[ST-Capsule-Bootstrap]', e);
  }
})();
`.trim();

    return {
        scripts: [
            {
                type: 'script',
                enabled: true,
                id: 'stcap_v2_self_installer',
                name: `${prefix}单卡内置世界书与预设自动部署器`,
                info: '当未安装 ST-Capsule-Packer v2.0 时，由酒馆助手自动解包安装本卡内置的全部世界书与专属预设。',
                button: { enabled: false, buttons: [] },
                data: {},
                content: scriptCode,
            },
        ],
        variables: {},
    };
}

// ============================================================================
// 4. SillyTavern Host Context & Module Bridge
// ============================================================================
function getCtx() {
    return window.SillyTavern?.getContext?.() || {};
}

async function getHostMods() {
    if (cachedMods) return cachedMods;
    const safeImport = async (relPath) => {
        try { return await import(relPath); } catch { return {}; }
    };
    const [scriptMod, wiMod, extMod, pmMod] = await Promise.all([
        safeImport('../../../../script.js'),
        safeImport('../../../world-info.js'),
        safeImport('../../../extensions.js'),
        safeImport('../../../preset-manager.js'),
    ]);
    cachedMods = { scriptMod, wiMod, extMod, pmMod };
    return cachedMods;
}

async function apiPost(url, bodyObj) {
    const ctx = getCtx();
    const headers = ctx.getRequestHeaders
        ? ctx.getRequestHeaders()
        : (cachedMods?.scriptMod?.getRequestHeaders ? cachedMods.scriptMod.getRequestHeaders() : { 'Content-Type': 'application/json' });
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj ?? {}),
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} (${url}): ${errText}`);
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await resp.json();
    return await resp.text();
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizeDownloadName(name) {
    return String(name || 'Character').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Character';
}

function isLukerAndroidApp() {
    return Boolean(
        window.LukerAndroid &&
        (typeof window.LukerAndroid.saveFileFromUrl === 'function' ||
         typeof window.LukerAndroid.saveFileFromDataUrl === 'function')
    );
}

// ============================================================================
// 5. Core Lifecycle Engine: Auto-Unpack, Auto-Preset-Switch & Cascade Delete
// ============================================================================
function suppressEnablementPopupsForCard(charObj, presetName, extSettings) {
    try {
        const avatar = charObj?.avatar;
        const charName = charObj?.name;
        if (avatar) {
            localStorage.setItem(`AlertWI_${avatar}`, 'true');
            localStorage.setItem(`AlertRegex_${avatar}`, 'true');
            if (!Array.isArray(extSettings.character_allowed_regex)) {
                extSettings.character_allowed_regex = [];
            }
            if (!extSettings.character_allowed_regex.includes(avatar)) {
                extSettings.character_allowed_regex.push(avatar);
            }
        }
        if (presetName) {
            localStorage.setItem(`AlertRegex_openai_${presetName}`, 'true');
            if (!extSettings.preset_allowed_regex || typeof extSettings.preset_allowed_regex !== 'object') {
                extSettings.preset_allowed_regex = {};
            }
            if (!Array.isArray(extSettings.preset_allowed_regex.openai)) {
                extSettings.preset_allowed_regex.openai = [];
            }
            if (!extSettings.preset_allowed_regex.openai.includes(presetName)) {
                extSettings.preset_allowed_regex.openai.push(presetName);
            }
        }
        if (charName && extSettings?.tavern_helper?.script?.popuped?.characters) {
            const pList = extSettings.tavern_helper.script.popuped.characters;
            if (Array.isArray(pList) && !pList.includes(charName)) pList.push(charName);
        }
    } catch {}
}

function switchPresetCleanly(pm, targetPresetName) {
    if (!pm || !targetPresetName) return false;
    const currentName = pm.getSelectedPresetName?.() || '';
    if (currentName === targetPresetName) return true;
    const optionVal = pm.findPreset?.(targetPresetName);
    if (optionVal !== undefined && optionVal !== null && optionVal !== '') {
        pm.selectPreset(optionVal);
        return true;
    }
    return false;
}

async function ensureCardBundleInstalled(chid, { forceReinstall = false, switchPreset = true } = {}) {
    const ctx = getCtx();
    const characters = ctx.characters || [];
    const charObj = characters[chid];
    if (!charObj) return false;

    const manifest = charObj?.data?.extensions?.st_capsule_manifest;
    const encodedBundle = charObj?.data?.extensions?.st_capsule_bundle;
    if (!manifest || !encodedBundle || manifest.spec !== BUNDLE_SPEC) return false;

    const avatar = charObj.avatar;
    if (!avatar || installingAvatars.has(avatar)) return false;

    const { wiMod, extMod, pmMod, scriptMod } = await getHostMods();
    const extension_settings = extMod.extension_settings || ctx.extensionSettings || {};
    const world_info = wiMod.world_info || {};
    const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;
    const pm = typeof getPresetManager === 'function' ? getPresetManager('openai') : null;

    const charKey = getCharKeyWithoutExt(avatar);
    const sig = `${manifest.bundle_id || manifest.prefix}:${(manifest.all_worldbooks || []).length}:${manifest.bound_preset?.name || ''}`;

    // Fast check if already verified in this browser session and bindings intact
    if (!forceReinstall && installedSessionSignatures.get(avatar) === sig) {
        if (switchPreset && manifest.bound_preset?.name && pm) {
            const curPreset = pm.getSelectedPresetName?.() || '';
            if (curPreset && !extractLeadingPrefix(curPreset) && !extractTrailingTag(curPreset)) {
                localStorage.setItem(LS_LAST_NORMAL_PRESET, curPreset);
            }
            switchPresetCleanly(pm, manifest.bound_preset.name);
        }
        return true;
    }

    // Check actual server world_names + charLore + preset presence
    let existingWorldSet = new Set(Array.isArray(wiMod.world_names) ? wiMod.world_names : []);
    if (existingWorldSet.size === 0 || forceReinstall) {
        try {
            const setJson = await apiPost('/api/settings/get', {});
            existingWorldSet = new Set(setJson.world_names || []);
        } catch {}
    }

    const expectedAllBooks = Array.isArray(manifest.all_worldbooks) ? manifest.all_worldbooks : [];
    const expectedExtraBooks = Array.isArray(manifest.extra_worldbooks) ? manifest.extra_worldbooks : [];
    const missingBooks = expectedAllBooks.filter(b => !existingWorldSet.has(b));

    const charLoreArr = world_info.charLore || [];
    const loreEntry = charLoreArr.find(e => e.name === charKey);
    const currentExtraSet = new Set(loreEntry?.extraBooks || []);
    const bindingComplete = expectedExtraBooks.every(b => currentExtraSet.has(b)) &&
        (!manifest.primary_worldbook || charObj?.data?.extensions?.world === manifest.primary_worldbook);

    const boundPresetName = manifest.bound_preset?.name || '';
    const hasBoundPreset = !boundPresetName || Boolean(pm?.findPreset?.(boundPresetName));

    suppressEnablementPopupsForCard(charObj, boundPresetName, extension_settings);

    if (!forceReinstall && missingBooks.length === 0 && bindingComplete && hasBoundPreset) {
        installedSessionSignatures.set(avatar, sig);
        if (switchPreset && boundPresetName && pm) {
            const curPreset = pm.getSelectedPresetName?.() || '';
            if (curPreset && !extractLeadingPrefix(curPreset) && !extractTrailingTag(curPreset)) {
                localStorage.setItem(LS_LAST_NORMAL_PRESET, curPreset);
            }
            if (curPreset !== boundPresetName && switchPresetCleanly(pm, boundPresetName)) {
                if (window.toastr) window.toastr.info(`已自动切换专属预设：${boundPresetName}`, '角色绑定预设');
            }
        }
        return true;
    }

    // Need to unpack & install!
    installingAvatars.add(avatar);
    try {
        if (window.toastr) {
            window.toastr.info(
                `正在自动展开 ${manifest.prefix || ''} 内置的 ${expectedAllBooks.length} 本世界书与专属预设...`,
                '单卡全内置自动部署',
                { timeOut: 4000 },
            );
        }

        const bundle = await decodeBundlePayload(encodedBundle);

        // 1. Write all worldbooks (only missing ones unless forceReinstall)
        const booksToWrite = (bundle.worldbooks || []).filter(wb => wb?.name && wb?.data && (forceReinstall || !existingWorldSet.has(wb.name)));
        for (const wb of booksToWrite) {
            const payload = JSON.parse(JSON.stringify(wb.data));
            payload.name = wb.name;
            await apiPost('/api/worldinfo/edit', { name: wb.name, data: payload });
        }

        // 2. CRITICAL: Refresh SillyTavern's in-memory world_names & dropdowns!
        if (typeof wiMod.updateWorldInfoList === 'function') {
            await wiMod.updateWorldInfoList();
        }

        // 3. Bind primary worldbook on character if needed
        if (manifest.primary_worldbook && charObj?.data?.extensions?.world !== manifest.primary_worldbook) {
            charObj.data = charObj.data || {};
            charObj.data.extensions = charObj.data.extensions || {};
            charObj.data.extensions.world = manifest.primary_worldbook;
            await apiPost('/api/characters/merge-attributes', {
                avatar: charObj.avatar,
                data: { extensions: { world: manifest.primary_worldbook } },
            }).catch(() => {});
        }

        // 4. CRITICAL: Bind extraBooks using exact stripped charKey (WITHOUT .png!)
        if (typeof wiMod.charSetAuxWorlds === 'function') {
            try { wiMod.charSetAuxWorlds(charKey, expectedExtraBooks); } catch {}
        }
        world_info.charLore = world_info.charLore || [];
        // Remove any accidental .png-suffixed stale entry
        const stalePngIdx = world_info.charLore.findIndex(e => e.name === avatar);
        if (stalePngIdx >= 0 && avatar !== charKey) {
            world_info.charLore.splice(stalePngIdx, 1);
        }
        const cleanIdx = world_info.charLore.findIndex(e => e.name === charKey);
        if (expectedExtraBooks.length > 0) {
            if (cleanIdx >= 0) {
                world_info.charLore[cleanIdx].extraBooks = [...new Set(expectedExtraBooks)];
            } else {
                world_info.charLore.push({ name: charKey, extraBooks: [...new Set(expectedExtraBooks)] });
            }
        }

        // 5. Install & select bound OpenAI preset
        if (bundle.preset?.name && bundle.preset?.data && pm?.savePreset) {
            const curPreset = pm.getSelectedPresetName?.() || '';
            if (curPreset && !extractLeadingPrefix(curPreset) && !extractTrailingTag(curPreset)) {
                localStorage.setItem(LS_LAST_NORMAL_PRESET, curPreset);
            }
            const pCopy = JSON.parse(JSON.stringify(bundle.preset.data));
            pCopy.name = bundle.preset.name;
            await pm.savePreset(bundle.preset.name, pCopy);
            suppressEnablementPopupsForCard(charObj, bundle.preset.name, extension_settings);
            if (switchPreset) {
                switchPresetCleanly(pm, bundle.preset.name);
            }
        }

        // 6. Optional chats inside bundle (only if bundle explicitly carries chats)
        if (Array.isArray(bundle.chats) && bundle.chats.length > 0) {
            let existingChatIds = new Set();
            try {
                const existResp = await apiPost('/api/characters/chats', { avatar_url: avatar, simple: true });
                if (Array.isArray(existResp)) {
                    existingChatIds = new Set(existResp.map(c => c.file_id || String(c.file_name || '').replace(/\.jsonl$/i, '')));
                }
            } catch {}
            for (const ch of bundle.chats) {
                if (!ch?.file_id || !Array.isArray(ch.messages) || existingChatIds.has(ch.file_id)) continue;
                await apiPost('/api/chats/save', {
                    ch_name: charObj.name,
                    file_name: ch.file_id,
                    chat: ch.messages,
                    avatar_url: avatar,
                    force: true,
                });
            }
        }

        // 7. Immediate saveSettings + update globe indicator
        if (typeof scriptMod.saveSettings === 'function') {
            await scriptMod.saveSettings();
        } else {
            ctx.saveSettingsDebounced?.();
        }
        if (typeof wiMod.setWorldInfoButtonClass === 'function') {
            try { wiMod.setWorldInfoButtonClass(chid); } catch {}
        }

        installedSessionSignatures.set(avatar, sig);
        if (window.toastr) {
            window.toastr.success(
                `已自动挂接 ${expectedAllBooks.length} 本 ${manifest.prefix || ''} 世界书并激活专属预设`,
                '单卡全内置部署完成',
            );
        }
        return true;
    } catch (err) {
        console.error('[ST-Capsule v2] Auto-install error:', err);
        if (window.toastr) window.toastr.error(`自动部署内置资产出错：${err?.message || err}`);
        return false;
    } finally {
        installingAvatars.delete(avatar);
    }
}

async function handleChatChangedAutoHooks() {
    try {
        const ctx = getCtx();
        const chid = ctx.characterId;
        const { pmMod } = await getHostMods();
        const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;
        const pm = typeof getPresetManager === 'function' ? getPresetManager('openai') : null;

        if (chid === undefined || chid === null || !ctx.characters?.[chid]) return;
        const charObj = ctx.characters[chid];
        const manifest = charObj?.data?.extensions?.st_capsule_manifest;

        if (manifest && manifest.spec === BUNDLE_SPEC) {
            await ensureCardBundleInstalled(chid, { switchPreset: true });
        } else if (pm) {
            // Switched to a normal non-bundle character: if currently sitting on a 【...】 bound preset, restore normal preset!
            const curPreset = pm.getSelectedPresetName?.() || '';
            const curPfx = extractLeadingPrefix(curPreset);
            const lastNormal = localStorage.getItem(LS_LAST_NORMAL_PRESET) || '';
            if (curPfx && lastNormal && lastNormal !== curPreset) {
                if (switchPresetCleanly(pm, lastNormal)) {
                    if (window.toastr) window.toastr.info(`已切回常规预设：${lastNormal}`, '预设自动还原');
                }
            }
        }
    } catch (err) {
        console.warn('[ST-Capsule v2] CHAT_CHANGED hook warning:', err);
    }
}

async function deleteBundleAssetsByPrefixOrManifest({ prefix, worldbookNames = [], presetName = '', deletedAvatar = '' }) {
    const ctx = getCtx();
    const { wiMod, pmMod, scriptMod, extMod } = await getHostMods();
    const world_info = wiMod.world_info || {};
    const extension_settings = extMod.extension_settings || ctx.extensionSettings || {};
    const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;
    const pm = typeof getPresetManager === 'function' ? getPresetManager('openai') : null;

    // Safety check: ensure no OTHER remaining character card uses the exact same prefix
    const remainingChars = (ctx.characters || []).filter(c => c && c.avatar !== deletedAvatar);
    if (prefix) {
        const stillUsed = remainingChars.some(c =>
            c?.data?.extensions?.st_capsule_manifest?.prefix === prefix ||
            String(c?.name || '').startsWith(prefix)
        );
        if (stillUsed) {
            console.info(`[ST-Capsule v2] Prefix ${prefix} is still used by another character; skipping shared deletion.`);
            return { deletedBooks: 0, deletedPresets: 0, skippedShared: true };
        }
    }

    // Gather all current world_names from server
    let serverWorlds = [];
    try {
        const setJson = await apiPost('/api/settings/get', {});
        serverWorlds = setJson.world_names || [];
    } catch {
        serverWorlds = Array.isArray(wiMod.world_names) ? [...wiMod.world_names] : [];
    }

    const booksToDelete = new Set(worldbookNames.filter(Boolean));
    if (prefix) {
        for (const w of serverWorlds) {
            if (w.startsWith(prefix) || w.endsWith(prefix)) booksToDelete.add(w);
        }
    }

    const serverWorldSet = new Set(serverWorlds);
    let deletedBooks = 0;
    for (const wbName of booksToDelete) {
        if (!serverWorldSet.has(wbName)) continue;
        try {
            await apiPost('/api/worldinfo/delete', { name: wbName });
            deletedBooks++;
        } catch (err) {
            console.warn(`[ST-Capsule v2] Failed to delete worldbook ${wbName}:`, err);
        }
    }

    // Clean charLore references
    if (Array.isArray(world_info.charLore)) {
        const deletedKey = getCharKeyWithoutExt(deletedAvatar);
        world_info.charLore = world_info.charLore
            .filter(entry => !deletedKey || (entry.name !== deletedKey && entry.name !== deletedAvatar))
            .map(entry => ({
                ...entry,
                extraBooks: (entry.extraBooks || []).filter(b => !booksToDelete.has(b)),
            }))
            .filter(entry => Array.isArray(entry.extraBooks) && entry.extraBooks.length > 0);
    }

    // Also remove from global selected_world_info if present
    if (Array.isArray(wiMod.selected_world_info)) {
        for (let i = wiMod.selected_world_info.length - 1; i >= 0; i--) {
            if (booksToDelete.has(wiMod.selected_world_info[i])) {
                wiMod.selected_world_info.splice(i, 1);
            }
        }
    }

    if (typeof wiMod.updateWorldInfoList === 'function') {
        await wiMod.updateWorldInfoList();
    }

    // Delete bound / prefixed OpenAI presets
    const presetsToDelete = new Set();
    if (presetName) presetsToDelete.add(presetName);
    if (prefix && pm?.getAllPresets) {
        for (const pName of (pm.getAllPresets() || [])) {
            if (pName.startsWith(prefix) || pName.endsWith(prefix)) presetsToDelete.add(pName);
        }
    }

    let deletedPresets = 0;
    for (const pName of presetsToDelete) {
        try {
            if (pm) {
                const curSelected = pm.getSelectedPresetName?.() || '';
                if (curSelected === pName) {
                    const fallback = localStorage.getItem(LS_LAST_NORMAL_PRESET) ||
                        (pm.getAllPresets?.() || []).find(x => !presetsToDelete.has(x)) || '';
                    if (fallback) switchPresetCleanly(pm, fallback);
                }
            }
            await apiPost('/api/presets/delete', { name: pName, apiId: 'openai' });
            if (extension_settings?.preset_allowed_regex?.openai) {
                extension_settings.preset_allowed_regex.openai =
                    extension_settings.preset_allowed_regex.openai.filter(x => x !== pName);
            }
            localStorage.removeItem(`AlertRegex_openai_${pName}`);
            deletedPresets++;
        } catch (err) {
            console.warn(`[ST-Capsule v2] Preset delete warning (${pName}):`, err);
        }
    }

    // Reload preset dropdown list cleanly
    if (deletedPresets > 0) {
        try {
            const setJson = await apiPost('/api/settings/get', {});
            if (pm && setJson.openai_setting_names && pm.presetNames) {
                // Trigger ST settings sync if available
            }
        } catch {}
    }

    if (deletedAvatar) {
        installedSessionSignatures.delete(deletedAvatar);
    }

    if (typeof scriptMod.saveSettings === 'function') {
        await scriptMod.saveSettings();
    } else {
        ctx.saveSettingsDebounced?.();
    }

    return { deletedBooks, deletedPresets, skippedShared: false };
}

async function handleCharacterDeletedEvent(payload) {
    try {
        const character = payload?.character;
        if (!character) return;
        const avatar = character.avatar || '';
        const manifest = character?.data?.extensions?.st_capsule_manifest;
        const leadingPfx = manifest?.prefix || extractLeadingPrefix(character.name || '');

        if (!manifest && !leadingPfx) return;

        const wbList = manifest?.all_worldbooks || [];
        const boundPreset = manifest?.bound_preset?.name || '';

        const res = await deleteBundleAssetsByPrefixOrManifest({
            prefix: leadingPfx,
            worldbookNames: wbList,
            presetName: boundPreset,
            deletedAvatar: avatar,
        });

        if (!res.skippedShared && (res.deletedBooks > 0 || res.deletedPresets > 0)) {
            if (window.toastr) {
                window.toastr.success(
                    `已随角色卡一并删除 ${res.deletedBooks} 本世界书与 ${res.deletedPresets} 套专属预设 (${leadingPfx || '绑定包'})`,
                    '全家桶级联清理完成',
                );
            }
        }
    } catch (err) {
        console.error('[ST-Capsule v2] CHARACTER_DELETED cascade error:', err);
    }
}

// ============================================================================
// 6. File Saving Bridge (Luker Android SAF Stream + Browser Download)
// ============================================================================
async function stageFileOnLocalServer(uint8Bytes, extSuffix) {
    try {
        const asciiTempName = `stcap_${Date.now()}${extSuffix}`;
        const b64 = uint8ToBase64(uint8Bytes);
        const resp = await apiPost('/api/files/upload', { name: asciiTempName, data: b64 });
        if (resp?.path) {
            const relPath = resp.path.startsWith('/') ? resp.path : `/${resp.path}`;
            const fullUrl = new URL(relPath, window.location.origin).href;
            return { ok: true, relPath, fullUrl, asciiTempName };
        }
    } catch (err) {
        console.warn('[ST-Capsule v2] /api/files/upload staging warning:', err);
    }
    return { ok: false, relPath: '', fullUrl: '', asciiTempName: '' };
}

function triggerHttpAnchorDownload(httpUrl, filename) {
    const a = document.createElement('a');
    a.href = httpUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 3000);
}

async function saveGeneratedPayload({ bytes, filename, mimeType, extSuffix }) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([u8], { type: mimeType });
    const staged = await stageFileOnLocalServer(u8, extSuffix);

    if (staged.ok && window.LukerAndroid && typeof window.LukerAndroid.saveFileFromUrl === 'function') {
        try {
            const ctx = getCtx();
            const reqHeaders = ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
            window.LukerAndroid.saveFileFromUrl(JSON.stringify({
                url: staged.fullUrl,
                fileName: filename,
                mimeType,
                method: 'GET',
                headers: reqHeaders,
            }));
            return { via: 'luker-stream-saf', staged };
        } catch (err) {
            console.warn('[ST-Capsule v2] saveFileFromUrl fallback:', err);
        }
    }

    if (staged.ok) {
        triggerHttpAnchorDownload(staged.fullUrl, filename);
        return { via: 'http-download', staged };
    }

    const url = URL.createObjectURL(blob);
    triggerHttpAnchorDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return { via: 'blob-download', staged };
}

// ============================================================================
// 7. Workspace Modal UI (Export All-in-One Card / Import Card / Clean Orphans)
// ============================================================================
async function inspectCurrentCharacterForExport() {
    const ctx = getCtx();
    const { wiMod, extMod, pmMod } = await getHostMods();

    const chid = ctx.characterId;
    const characters = ctx.characters || [];
    if (chid === undefined || chid === null || !characters[chid]) return null;

    const charObj = characters[chid];
    const avatar = charObj.avatar;
    const charKey = getCharKeyWithoutExt(avatar);

    const world_info = wiMod.world_info || {};
    const selected_world_info = wiMod.selected_world_info || world_info.globalSelect || [];
    let allWorldNames = Array.isArray(wiMod.world_names) && wiMod.world_names.length ? [...wiMod.world_names] : [];
    if (!allWorldNames.length) {
        try {
            const s = await apiPost('/api/settings/get', {});
            allWorldNames = s.world_names || [];
        } catch {}
    }

    const primaryWb = charObj?.data?.extensions?.world || '';
    const charLoreEntry = Array.isArray(world_info.charLore)
        ? world_info.charLore.find(e => e.name === charKey || e.name === avatar)
        : null;
    const extraWbs = Array.isArray(charLoreEntry?.extraBooks) ? [...charLoreEntry.extraBooks] : [];
    const boundSet = new Set([primaryWb, ...extraWbs].filter(Boolean));

    const worldbookOptions = allWorldNames.map(name => ({
        name,
        isPrimary: name === primaryWb,
        isExtra: extraWbs.includes(name),
        isGlobal: selected_world_info.includes(name),
        defaultChecked: boundSet.has(name),
    })).sort((a, b) => (Number(b.defaultChecked) - Number(a.defaultChecked)) || a.name.localeCompare(b.name, 'zh-CN'));

    let chatFiles = [];
    try {
        const rawChats = await apiPost('/api/characters/chats', { avatar_url: avatar, simple: true });
        if (Array.isArray(rawChats)) {
            chatFiles = rawChats.map(c => {
                const fileName = c.file_name || c.file_id || '';
                const fileId = String(fileName).replace(/\.jsonl$/i, '');
                return { fileName, fileId, messageCount: c.chat_items ?? c.mes_count ?? '?' };
            }).filter(c => c.fileId);
        }
    } catch {}

    const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;
    const pm = typeof getPresetManager === 'function' ? getPresetManager('openai') : null;
    const activePresetName = pm?.getSelectedPresetName?.() || '';
    const presetNames = pm?.getAllPresets?.() || (activePresetName ? [activePresetName] : []);

    const extension_settings = extMod.extension_settings || ctx.extensionSettings || {};
    const scopedRegex = Array.isArray(charObj?.data?.extensions?.regex_scripts) ? charObj.data.extensions.regex_scripts : [];
    const activePresetData = pm?.getCompletionPresetByName?.(activePresetName) || pm?.getPresetSettings?.(activePresetName);
    const presetRegex = Array.isArray(activePresetData?.extensions?.regex_scripts) ? activePresetData.extensions.regex_scripts : [];

    return {
        chid,
        charObj,
        avatar,
        charKey,
        rawName: charObj.name || charKey || 'Character',
        cleanBaseName: stripAnyBundleAffixes(charObj.name || charKey || 'Character'),
        worldbookOptions,
        boundCount: boundSet.size,
        chatFiles,
        pm,
        activePresetName,
        presetNames,
        scopedRegex,
        presetRegex,
        extension_settings,
    };
}

function createModalShell(initialTab = 'export') {
    document.querySelectorAll('.stcap-dialog, .stcap-overlay-fallback').forEach(el => {
        try { if (typeof el.close === 'function' && el.open) el.close(); } catch {}
        el.remove();
    });

    const supportsDialog = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
    const rootEl = document.createElement(supportsDialog ? 'dialog' : 'div');
    rootEl.className = supportsDialog ? 'stcap-dialog' : 'stcap-overlay-fallback';
    rootEl.innerHTML = `
      <div class="stcap-modal">
        <div class="stcap-hazard-bar"></div>
        <div class="stcap-header">
          <div class="stcap-title-wrap">
            <span class="stcap-title">📦 全内置角色卡工作台 v2.0</span>
            <span class="stcap-neon-tag">${isLukerAndroidApp() ? 'Luker Android 直连' : '单卡多世界书+预设+级联删除'}</span>
          </div>
          <button type="button" class="stcap-close" title="关闭">✕</button>
        </div>
        <div class="stcap-tabs">
          <button type="button" class="stcap-tab ${initialTab === 'export' ? 'active' : ''}" data-tab="export">📤 打包单卡导出</button>
          <button type="button" class="stcap-tab ${initialTab === 'import' ? 'active' : ''}" data-tab="import">📥 导入单卡 / 胶囊</button>
          <button type="button" class="stcap-tab ${initialTab === 'clean' ? 'active' : ''}" data-tab="clean">🧹 前缀批次清理</button>
        </div>
        <div class="stcap-body" id="stcap-body"></div>
        <div class="stcap-footer" id="stcap-footer"></div>
      </div>
    `;

    document.body.appendChild(rootEl);
    if (supportsDialog) {
        try { rootEl.showModal(); } catch { rootEl.setAttribute('open', ''); }
    }
    const closeModal = () => {
        try { if (supportsDialog && rootEl.open) rootEl.close(); } catch {}
        rootEl.remove();
    };
    rootEl.querySelector('.stcap-close')?.addEventListener('click', closeModal);
    rootEl.addEventListener('click', (e) => { if (e.target === rootEl) closeModal(); });
    return { rootEl, closeModal };
}

export async function openCapsuleModal(initialTab = 'export') {
    ensureCriticalStyles();
    const { rootEl } = createModalShell(initialTab);
    const bodyEl = rootEl.querySelector('#stcap-body');
    const footerEl = rootEl.querySelector('#stcap-footer');

    rootEl.querySelectorAll('.stcap-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            rootEl.querySelectorAll('.stcap-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tName = tab.dataset.tab;
            if (tName === 'export') await renderExportTab();
            else if (tName === 'import') renderImportTab();
            else await renderCleanTab();
        });
    });

    async function renderExportTab() {
        bodyEl.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8;">正在扫描当前角色绑定的多世界书与预设...</div>`;
        footerEl.innerHTML = '';

        const info = await inspectCurrentCharacterForExport();
        if (!info) {
            bodyEl.innerHTML = `
              <div class="stcap-section" style="text-align:center;padding:24px;">
                <div style="font-size:15px;font-weight:700;color:#fca5a5;">当前未打开任何角色卡</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:6px;">请先点进一张角色卡，再点击「打包单卡导出」；或切换到上方标签执行导入/清理。</div>
              </div>
            `;
            return;
        }

        const defaultPfx = makeFreshPrefix('ST');
        const avatarSrc = `/characters/${encodeURIComponent(info.avatar)}`;

        bodyEl.innerHTML = `
          <div class="stcap-char-banner">
            <img src="${avatarSrc}" onerror="this.style.display='none'" alt="avatar" />
            <div class="stcap-char-meta">
              <div class="stcap-char-name">${escapeHtml(info.rawName)}</div>
              <div class="stcap-char-sub">
                已绑定世界书 <b>${info.boundCount}</b> 本 · 当前预设 <b>${escapeHtml(info.activePresetName || '无')}</b> · 局部正则 <b>${info.scopedRegex.length}</b> 条 · 预设正则 <b>${info.presetRegex.length}</b> 条
              </div>
            </div>
          </div>

          <div class="stcap-section" style="border-color:rgba(74,222,128,0.4);background:rgba(74,222,128,0.06);">
            <div class="stcap-section-head">
              <span class="stcap-section-title">🏷️ 统一最前端唯一前缀（自动加在角色卡、全部世界书和预设最前面，删卡时一并全删）</span>
              <button type="button" class="stcap-mini-btn" id="stcap-regen-pfx">🎲 刷新唯一前缀</button>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="text" class="stcap-search" id="stcap-export-pfx" value="${escapeHtml(defaultPfx)}" style="max-width:240px;font-weight:700;color:#4ade80;" />
              <span style="font-size:12px;color:#cbd5e1;" id="stcap-pfx-preview">导出卡名预览：<b>${escapeHtml(applyFrontPrefix(defaultPfx, info.cleanBaseName))}</b></span>
            </div>
          </div>

          <div class="stcap-grid">
            <div class="stcap-section">
              <div class="stcap-section-title">🎛️ 内置绑定预设与正则</div>
              <label class="stcap-item">
                <input type="checkbox" id="stcap-inc-preset" checked />
                <span class="stcap-item-label">内置专属预设（切进该卡自动切此预设）</span>
              </label>
              <select id="stcap-preset-sel" class="stcap-search">
                ${info.presetNames.map(p => `<option value="${escapeHtml(p)}" ${p === info.activePresetName ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
              </select>
              <label class="stcap-item">
                <input type="checkbox" id="stcap-inc-sregex" checked />
                <span class="stcap-item-label">内置角色局部正则 (${info.scopedRegex.length} 条)</span>
              </label>
              <div style="font-size:11px;color:#94a3b8;line-height:1.45;">
                预设自带的 ${info.presetRegex.length} 条正则已包含在专属预设内部，导入后自动授权启用，删卡时连同预设与全部世界书一起删除。
              </div>
            </div>

            <div class="stcap-section">
              <div class="stcap-section-head">
                <span class="stcap-section-title">🌍 内置多本世界书 (已选 <span id="stcap-wb-cnt">${info.worldbookOptions.filter(w => w.defaultChecked).length}</span> 本)</span>
                <div class="stcap-mini-actions">
                  <button type="button" class="stcap-mini-btn" id="stcap-wb-bound">仅角色绑定</button>
                  <button type="button" class="stcap-mini-btn" id="stcap-wb-all">全选</button>
                </div>
              </div>
              <input type="text" class="stcap-search" id="stcap-wb-filter" placeholder="搜索世界书..." />
              <div class="stcap-list" id="stcap-wb-list">
                ${info.worldbookOptions.map(w => `
                  <label class="stcap-item" data-name="${escapeHtml(w.name.toLowerCase())}">
                    <input type="checkbox" class="stcap-wb-cb" value="${escapeHtml(w.name)}" ${w.defaultChecked ? 'checked' : ''} />
                    <span class="stcap-item-label" title="${escapeHtml(w.name)}">${escapeHtml(w.name)}</span>
                    ${w.isPrimary ? '<span class="stcap-item-sub">主书</span>' : w.isExtra ? '<span class="stcap-item-sub">附加</span>' : w.isGlobal ? '<span class="stcap-item-sub">全局</span>' : ''}
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="stcap-section">
              <div class="stcap-section-head">
                <span class="stcap-section-title">💬 可选附带聊天记录 (默认不带，保持新卡干净)</span>
                <div class="stcap-mini-actions">
                  <button type="button" class="stcap-mini-btn" id="stcap-chat-none">清空</button>
                  <button type="button" class="stcap-mini-btn" id="stcap-chat-all">全选(${info.chatFiles.length})</button>
                </div>
              </div>
              <div class="stcap-list" id="stcap-chat-list">
                ${info.chatFiles.length === 0 ? '<div style="color:#64748b;font-size:12px;padding:6px;">暂无历史聊天分支</div>' : info.chatFiles.map(c => `
                  <label class="stcap-item">
                    <input type="checkbox" class="stcap-chat-cb" value="${escapeHtml(c.fileId)}" />
                    <span class="stcap-item-label">${escapeHtml(c.fileId)}</span>
                    <span class="stcap-item-sub">${escapeHtml(String(c.messageCount))} 条</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
          <div id="stcap-export-dl-box" style="display:none;"></div>
        `;

        footerEl.innerHTML = `
          <div class="stcap-status" id="stcap-status">提示：手机/微信传输强烈推荐导出 .charx（酒馆原生「导入角色卡」直接识别且微信不压缩）</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="stcap-secondary-btn" id="stcap-btn-png">🖼️ 导出全内置 .png 卡</button>
            <button type="button" class="stcap-primary-btn" id="stcap-btn-charx">📦 导出全内置 .charx 卡 (推荐)</button>
          </div>
        `;

        const pfxInput = bodyEl.querySelector('#stcap-export-pfx');
        const pfxPreview = bodyEl.querySelector('#stcap-pfx-preview');
        const refreshPfxPreview = () => {
            const p = normalizeFrontPrefix(pfxInput.value);
            pfxPreview.innerHTML = `导出卡名预览：<b>${escapeHtml(applyFrontPrefix(p, info.cleanBaseName))}</b>`;
        };
        pfxInput.addEventListener('input', refreshPfxPreview);
        bodyEl.querySelector('#stcap-regen-pfx')?.addEventListener('click', () => {
            pfxInput.value = makeFreshPrefix('ST');
            refreshPfxPreview();
        });

        const updateWbCnt = () => {
            bodyEl.querySelector('#stcap-wb-cnt').textContent = String(bodyEl.querySelectorAll('.stcap-wb-cb:checked').length);
        };
        bodyEl.querySelector('#stcap-wb-list')?.addEventListener('change', updateWbCnt);
        bodyEl.querySelector('#stcap-wb-bound')?.addEventListener('click', () => {
            const bSet = new Set(info.worldbookOptions.filter(w => w.defaultChecked).map(w => w.name));
            bodyEl.querySelectorAll('.stcap-wb-cb').forEach(cb => { cb.checked = bSet.has(cb.value); });
            updateWbCnt();
        });
        bodyEl.querySelector('#stcap-wb-all')?.addEventListener('click', () => {
            bodyEl.querySelectorAll('.stcap-wb-cb').forEach(cb => { cb.checked = true; });
            updateWbCnt();
        });
        bodyEl.querySelector('#stcap-wb-filter')?.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            bodyEl.querySelectorAll('#stcap-wb-list .stcap-item').forEach(row => {
                row.style.display = (!q || (row.dataset.name || '').includes(q)) ? 'flex' : 'none';
            });
        });
        bodyEl.querySelector('#stcap-chat-none')?.addEventListener('click', () => {
            bodyEl.querySelectorAll('.stcap-chat-cb').forEach(cb => { cb.checked = false; });
        });
        bodyEl.querySelector('#stcap-chat-all')?.addEventListener('click', () => {
            bodyEl.querySelectorAll('.stcap-chat-cb').forEach(cb => { cb.checked = true; });
        });

        const runExport = async (format) => {
            const statusEl = footerEl.querySelector('#stcap-status');
            const btns = footerEl.querySelectorAll('button');
            btns.forEach(b => { b.disabled = true; });
            try {
                const prefix = normalizeFrontPrefix(pfxInput.value);
                const finalCardName = applyFrontPrefix(prefix, info.cleanBaseName);
                const selectedOrigWbs = [...bodyEl.querySelectorAll('.stcap-wb-cb:checked')].map(c => c.value);

                statusEl.textContent = `正在读取 ${selectedOrigWbs.length} 本世界书...`;
                const bundledBooks = [];
                for (let i = 0; i < selectedOrigWbs.length; i++) {
                    const origWbName = selectedOrigWbs[i];
                    const prefixedWbName = applyFrontPrefix(prefix, origWbName);
                    const wbData = await apiPost('/api/worldinfo/get', { name: origWbName });
                    const wbCopy = JSON.parse(JSON.stringify(wbData || { entries: {} }));
                    wbCopy.name = prefixedWbName;
                    bundledBooks.push({
                        name: prefixedWbName,
                        is_primary: i === 0,
                        data: wbCopy,
                    });
                }

                let bundledPreset = null;
                if (bodyEl.querySelector('#stcap-inc-preset')?.checked) {
                    const origPresetName = bodyEl.querySelector('#stcap-preset-sel')?.value || info.activePresetName;
                    if (origPresetName && info.pm) {
                        const rawP = info.pm.getCompletionPresetByName?.(origPresetName) || info.pm.getPresetSettings?.(origPresetName);
                        if (rawP) {
                            const prefixedPresetName = applyFrontPrefix(prefix, origPresetName);
                            const pCopy = JSON.parse(JSON.stringify(rawP));
                            pCopy.name = prefixedPresetName;
                            bundledPreset = { api_id: 'openai', name: prefixedPresetName, data: pCopy };
                        }
                    }
                }

                const selectedChatIds = [...bodyEl.querySelectorAll('.stcap-chat-cb:checked')].map(c => c.value);
                const bundledChats = [];
                for (const cid of selectedChatIds) {
                    const msgs = await apiPost('/api/chats/get', { ch_name: info.charObj.name, file_name: cid, avatar_url: info.avatar });
                    if (Array.isArray(msgs)) bundledChats.push({ file_id: cid, messages: msgs });
                }

                // Fetch clean avatar image
                const ctx = getCtx();
                const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : {};
                let pureAvatarBytes = null;
                const expResp = await fetch('/api/characters/export', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ format: 'png', avatar_url: info.avatar }),
                });
                if (expResp.ok) {
                    pureAvatarBytes = stripPngToPureImage(new Uint8Array(await expResp.arrayBuffer()));
                } else {
                    const imgResp = await fetch(`/characters/${encodeURIComponent(info.avatar)}`);
                    pureAvatarBytes = stripPngToPureImage(new Uint8Array(await imgResp.arrayBuffer()));
                }

                // Build V2 Card with embedded manifest + compressed bundle + TavernHelper fallback
                const cardCopy = JSON.parse(JSON.stringify(info.charObj));
                delete cardCopy.chat;
                delete cardCopy.create_date;
                cardCopy.name = finalCardName;
                cardCopy.spec = 'chara_card_v2';
                cardCopy.spec_version = '2.0';
                cardCopy.data = cardCopy.data || {};
                cardCopy.data.name = finalCardName;
                cardCopy.data.extensions = cardCopy.data.extensions || {};

                const allWbNames = bundledBooks.map(b => b.name);
                const primaryWbName = allWbNames[0] || '';
                const extraWbNames = allWbNames.slice(1);

                if (primaryWbName) cardCopy.data.extensions.world = primaryWbName;
                if (bodyEl.querySelector('#stcap-inc-sregex')?.checked && info.scopedRegex.length) {
                    cardCopy.data.extensions.regex_scripts = info.scopedRegex.map(rx => ({
                        ...rx,
                        scriptName: applyFrontPrefix(prefix, rx.scriptName || 'Regex'),
                    }));
                }

                cardCopy.data.extensions.st_capsule_manifest = {
                    spec: BUNDLE_SPEC,
                    version: '2.0.0',
                    bundle_id: prefix.replace(/[【】\[\]\s]/g, ''),
                    prefix,
                    exported_at: new Date().toISOString(),
                    primary_worldbook: primaryWbName,
                    extra_worldbooks: extraWbNames,
                    all_worldbooks: allWbNames,
                    bound_preset: bundledPreset ? { api_id: 'openai', name: bundledPreset.name } : null,
                    has_chats: bundledChats.length > 0,
                    chat_count: bundledChats.length,
                };

                statusEl.textContent = '正在 GZIP 压缩多世界书与专属预设进单张角色卡...';
                cardCopy.data.extensions.st_capsule_bundle = await gzipStringToBase64(JSON.stringify({
                    worldbooks: bundledBooks,
                    preset: bundledPreset,
                    chats: bundledChats,
                }));
                cardCopy.data.extensions.tavern_helper = buildEmbeddedTavernHelperBootstrapScript(prefix);

                const safeFileBase = sanitizeDownloadName(finalCardName);
                let outBytes;
                let outName;
                let mimeType;
                let extSuffix;

                if (format === 'charx') {
                    outBytes = buildCharXBytes(pureAvatarBytes, cardCopy);
                    outName = `${safeFileBase}.charx`;
                    mimeType = 'application/octet-stream';
                    extSuffix = '.charx';
                } else {
                    outBytes = buildCleanCardPngBytes(pureAvatarBytes, cardCopy);
                    outName = `${safeFileBase}.png`;
                    mimeType = 'image/png';
                    extSuffix = '.png';
                }

                const mb = (outBytes.byteLength / 1048576).toFixed(2);
                const saved = await saveGeneratedPayload({ bytes: outBytes, filename: outName, mimeType, extSuffix });
                statusEl.textContent = `✅ 已生成全内置单卡 ${outName} (${mb} MB)`;
                if (saved.staged?.ok) {
                    const dlBox = bodyEl.querySelector('#stcap-export-dl-box');
                    dlBox.style.display = 'block';
                    dlBox.innerHTML = `
                      <div class="stcap-section" style="border-color:rgba(74,222,128,0.45);background:rgba(74,222,128,0.1);">
                        <div style="font-size:12px;color:#86efac;font-weight:700;">📥 若未自动弹出保存框，点击下方直链保存 (${mb} MB)：</div>
                        <a href="${escapeHtml(saved.staged.fullUrl)}" download="${escapeHtml(outName)}" target="_blank" class="stcap-primary-btn" style="text-decoration:none;display:inline-block;width:fit-content;">点击下载 ${escapeHtml(outName)}</a>
                      </div>
                    `;
                }
            } catch (err) {
                console.error('[ST-Capsule v2] Export error:', err);
                statusEl.textContent = `❌ 导出失败：${err?.message || err}`;
            } finally {
                btns.forEach(b => { b.disabled = false; });
            }
        };

        footerEl.querySelector('#stcap-btn-charx')?.addEventListener('click', () => runExport('charx'));
        footerEl.querySelector('#stcap-btn-png')?.addEventListener('click', () => runExport('png'));
    }

    function renderImportTab() {
        bodyEl.innerHTML = `
          <div class="stcap-dropzone" id="stcap-dropzone">
            <div style="font-size:15px;font-weight:700;color:#e9d5ff;">点击选择全内置角色卡 (.charx / .png) 或旧版胶囊 (.stcapsule.json)</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:6px;">
              注：v2.0 全内置 .charx / .png 角色卡也可直接用酒馆自带的「导入角色卡」按钮导入，插件会自动解包全部世界书与专属预设。
            </div>
            <input type="file" id="stcap-file-in" accept=".charx,.png,.json,application/octet-stream,image/png,application/json" style="display:none;" />
          </div>
          <div id="stcap-imp-info"></div>
        `;
        footerEl.innerHTML = `
          <div class="stcap-status" id="stcap-imp-status">请选择要导入的文件</div>
          <button type="button" class="stcap-primary-btn" id="stcap-imp-go" disabled>⚡ 一键导入角色卡并自动挂齐世界书与预设</button>
        `;

        const dz = bodyEl.querySelector('#stcap-dropzone');
        const fi = bodyEl.querySelector('#stcap-file-in');
        const infoBox = bodyEl.querySelector('#stcap-imp-info');
        const stEl = footerEl.querySelector('#stcap-imp-status');
        const goBtn = footerEl.querySelector('#stcap-imp-go');
        let selectedFile = null;

        dz.addEventListener('click', () => fi.click());
        fi.addEventListener('change', async () => {
            if (!fi.files?.[0]) return;
            selectedFile = fi.files[0];
            try {
                const u8 = new Uint8Array(await selectedFile.arrayBuffer());
                let cardObj = null;
                if (isZipBytes(u8) || selectedFile.name.toLowerCase().endsWith('.charx')) {
                    const zf = await readFilesFromZipBytes(u8);
                    const cj = zf.get('card.json');
                    if (!cj) throw new Error('CharX 内缺少 card.json');
                    cardObj = JSON.parse(new TextDecoder('utf-8').decode(cj));
                } else if (isPngBytes(u8)) {
                    const chunks = extractPngChunks(u8);
                    for (const ch of chunks) {
                        if (ch.name === 'tEXt') {
                            const dec = decodeTextChunk(ch.data);
                            if (dec && (dec.keyword === 'ccv3' || dec.keyword === 'chara')) {
                                cardObj = JSON.parse(base64ToUtf8(dec.text));
                                break;
                            }
                        }
                    }
                } else {
                    const parsed = JSON.parse(new TextDecoder('utf-8').decode(u8));
                    cardObj = parsed.spec === 'st_capsule_v1' ? parsed.character?.card : parsed;
                }
                const mf = cardObj?.data?.extensions?.st_capsule_manifest;
                const cName = cardObj?.data?.name || cardObj?.name || selectedFile.name;
                infoBox.innerHTML = `
                  <div class="stcap-section">
                    <div class="stcap-section-title">✅ 已识别卡片：${escapeHtml(cName)}</div>
                    <div style="font-size:12px;color:#cbd5e1;line-height:1.6;">
                      ${mf ? `内置唯一前缀：<b>${escapeHtml(mf.prefix)}</b> · 内置世界书：<b>${(mf.all_worldbooks || []).length} 本</b> · 专属预设：<b>${escapeHtml(mf.bound_preset?.name || '无')}</b>` : '普通标准角色卡'}
                    </div>
                  </div>
                `;
                stEl.textContent = `准备就绪：${cName}`;
                goBtn.disabled = false;
            } catch (err) {
                stEl.textContent = `❌ 文件解析失败：${err?.message || err}`;
                goBtn.disabled = true;
            }
        });

        goBtn.addEventListener('click', async () => {
            if (!selectedFile) return;
            goBtn.disabled = true;
            try {
                const ctx = getCtx();
                const ext = selectedFile.name.toLowerCase().endsWith('.charx') ? 'charx'
                    : selectedFile.name.toLowerCase().endsWith('.png') ? 'png' : 'json';
                stEl.textContent = '正在向酒馆导入角色卡主体...';

                const fd = new FormData();
                fd.append('avatar', selectedFile, selectedFile.name);
                fd.append('file_type', ext);
                const headers = ctx.getRequestHeaders ? { ...ctx.getRequestHeaders() } : {};
                delete headers['Content-Type'];

                const resp = await fetch('/api/characters/import', { method: 'POST', headers, body: fd });
                const rJson = await resp.json();
                if (!resp.ok || rJson.error || !rJson.file_name) {
                    throw new Error(rJson.error || '导入角色卡接口返回失败');
                }
                const newAvatar = `${rJson.file_name}.png`;
                if (typeof ctx.getCharacters === 'function') await ctx.getCharacters();
                const newChid = (ctx.characters || []).findIndex(c => c.avatar === newAvatar);
                if (newChid >= 0) {
                    stEl.textContent = '正在自动解包并挂接全部世界书与专属预设...';
                    await ensureCardBundleInstalled(newChid, { forceReinstall: true, switchPreset: true });
                }
                stEl.textContent = `✅ 导入并自动挂接完成：${rJson.file_name}`;
            } catch (err) {
                stEl.textContent = `❌ 导入失败：${err?.message || err}`;
            } finally {
                goBtn.disabled = false;
            }
        });
    }

    async function renderCleanTab() {
        bodyEl.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8;">正在扫描带前缀/后缀的世界书与预设批次...</div>`;
        footerEl.innerHTML = `<div class="stcap-status">可在此一键清理旧测试包残留的世界书与预设</div>`;

        const ctx = getCtx();
        const { pmMod } = await getHostMods();
        const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;
        const pm = typeof getPresetManager === 'function' ? getPresetManager('openai') : null;

        let worldNames = [];
        try {
            const s = await apiPost('/api/settings/get', {});
            worldNames = s.world_names || [];
        } catch {}
        const presetNames = pm?.getAllPresets?.() || [];
        const chars = ctx.characters || [];

        // Group by either front prefix 【...】 / [...] OR legacy trailing [AGY...]
        const groups = new Map();
        const addGroupItem = (tag, kind, itemName) => {
            if (!tag) return;
            if (!groups.has(tag)) groups.set(tag, { tag, books: [], presets: [], cards: [] });
            groups.get(tag)[kind].push(itemName);
        };

        for (const w of worldNames) {
            const tag = extractLeadingPrefix(w) || extractTrailingTag(w);
            if (tag) addGroupItem(tag, 'books', w);
        }
        for (const p of presetNames) {
            const tag = extractLeadingPrefix(p) || extractTrailingTag(p);
            if (tag) addGroupItem(tag, 'presets', p);
        }
        for (const c of chars) {
            const mfPfx = c?.data?.extensions?.st_capsule_manifest?.prefix;
            const cName = c?.name || '';
            const tag = mfPfx || extractLeadingPrefix(cName) || (cName.includes('[AGY1127]') ? '[AGY1127]' : '');
            if (tag) addGroupItem(tag, 'cards', cName);
        }

        if (groups.size === 0) {
            bodyEl.innerHTML = `<div class="stcap-section" style="text-align:center;padding:24px;color:#86efac;">当前酒馆非常干净，没有任何带批次前缀/后缀的世界书或预设。</div>`;
            return;
        }

        bodyEl.innerHTML = [...groups.values()].map(g => `
          <div class="stcap-section">
            <div class="stcap-section-head">
              <div>
                <span class="stcap-section-title">批次标识：${escapeHtml(g.tag)}</span>
                <span class="stcap-item-sub" style="margin-left:8px;">
                  ${g.cards.length ? `🟢 关联在用角色卡 (${g.cards.length})` : '🟠 无关联角色卡 (历史残留)'}
                </span>
              </div>
              <button type="button" class="stcap-danger-btn" data-clean-tag="${escapeHtml(g.tag)}">
                🗑️ 清理该批次 (${g.books.length} 本书 + ${g.presets.length} 预设)
              </button>
            </div>
            <div style="font-size:12px;color:#94a3b8;">
              世界书 ${g.books.length} 本 · 预设 ${g.presets.length} 套 ${g.cards.length ? `· 角色卡：${escapeHtml(g.cards.join('、'))}（注：若直接去角色列表删除该角色卡，也会自动连带删除这些世界书和预设）` : ''}
            </div>
          </div>
        `).join('');

        bodyEl.querySelectorAll('[data-clean-tag]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.dataset.cleanTag;
                const grp = groups.get(tag);
                if (!grp) return;
                btn.disabled = true;
                btn.textContent = '正在清理...';
                try {
                    // Force clean regardless of remaining char if user clicked explicit clean button
                    const res = await deleteBundleAssetsByPrefixOrManifest({
                        prefix: '',
                        worldbookNames: grp.books,
                        presetName: grp.presets[0] || '',
                        deletedAvatar: '__manual_force__',
                    });
                    for (const extraP of grp.presets.slice(1)) {
                        await apiPost('/api/presets/delete', { name: extraP, apiId: 'openai' }).catch(() => {});
                    }
                    if (window.toastr) window.toastr.success(`已清理批次 ${tag}：${res.deletedBooks} 本世界书`);
                    await renderCleanTab();
                } catch (err) {
                    btn.textContent = '清理出错';
                    console.error(err);
                }
            });
        });
    }

    if (initialTab === 'export') await renderExportTab();
    else if (initialTab === 'import') renderImportTab();
    else await renderCleanTab();
}

// ============================================================================
// 8. Mounting, Event Listeners & Background New-Card Scanner
// ============================================================================
function mountUiControls() {
    ensureCriticalStyles();

    const drawerTarget = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (drawerTarget && !document.getElementById('st_capsule_packer_container')) {
        const wrap = document.createElement('div');
        wrap.className = 'extension_container';
        wrap.id = 'st_capsule_packer_container';
        wrap.innerHTML = `
          <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>📦 全内置角色卡打包器 v2.0 (多世界书+预设+删卡全清)</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content stcap-drawer-box">
              <div style="color:#94a3b8;line-height:1.5;">
                将多本绑定世界书、专属预设与正则直接内嵌进单张 <code>.charx</code> / <code>.png</code> 角色卡（统一前置唯一前缀，点卡自动装齐并切换预设，删卡自动连带全删）。
              </div>
              <div class="stcap-btn-row">
                <button type="button" class="stcap-trigger-btn" id="stcap-open-export">📤 打包单卡导出</button>
                <button type="button" class="stcap-trigger-btn" id="stcap-open-import">📥 导入单卡</button>
                <button type="button" class="stcap-trigger-btn" id="stcap-open-clean">🧹 前缀残留清理</button>
              </div>
            </div>
          </div>
        `;
        drawerTarget.appendChild(wrap);
    }

    const wandMenu = document.getElementById('extensionsMenu');
    if (wandMenu && !document.getElementById('stcap-wand-item')) {
        const wandItem = document.createElement('div');
        wandItem.id = 'stcap-wand-item';
        wandItem.className = 'list-group-item flex-container flexGap5 interactable';
        wandItem.tabIndex = 0;
        wandItem.innerHTML = `
          <div class="fa-solid fa-box-archive extensionsMenuExtensionButton"></div>
          <span>全内置角色卡打包 / 清理 (v2.0)</span>
        `;
        wandMenu.appendChild(wandItem);
    }
}

function bindGlobalClicksOnce() {
    if (window.__stcapV2ClickBound) return;
    window.__stcapV2ClickBound = true;
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('#stcap-open-export') || t.closest('#stcap-wand-item')) {
            e.preventDefault(); e.stopPropagation();
            openCapsuleModal('export');
        } else if (t.closest('#stcap-open-import')) {
            e.preventDefault(); e.stopPropagation();
            openCapsuleModal('import');
        } else if (t.closest('#stcap-open-clean')) {
            e.preventDefault(); e.stopPropagation();
            openCapsuleModal('clean');
        }
    }, true);
}

async function bootExtensionV2() {
    window.__ST_CAPSULE_PACKER_V2_ACTIVE__ = true;
    bindGlobalClicksOnce();
    mountUiControls();

    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        mountUiControls();
        if (document.getElementById('st_capsule_packer_container') || attempts > 20) clearInterval(timer);
    }, 1000);

    try {
        const ctx = getCtx();
        const { scriptMod } = await getHostMods();
        const evSource = ctx.eventSource || scriptMod.eventSource;
        const evTypes = ctx.eventTypes || ctx.event_types || scriptMod.event_types || {};

        if (evSource && typeof evSource.on === 'function') {
            if (evTypes.APP_READY) evSource.on(evTypes.APP_READY, () => { mountUiControls(); handleChatChangedAutoHooks(); });
            if (evTypes.CHAT_CHANGED) evSource.on(evTypes.CHAT_CHANGED, handleChatChangedAutoHooks);
            if (evTypes.CHARACTER_DELETED) evSource.on(evTypes.CHARACTER_DELETED, handleCharacterDeletedEvent);
        }

        // Also scan newly imported characters right after native Character Import!
        let knownCharCount = (ctx.characters || []).length;
        setInterval(() => {
            const curChars = ctx.characters || [];
            if (curChars.length > knownCharCount) {
                // Check newly added character(s) at the end or any un-installed v2 card
                for (let i = 0; i < curChars.length; i++) {
                    const mf = curChars[i]?.data?.extensions?.st_capsule_manifest;
                    if (mf?.spec === BUNDLE_SPEC && !installedSessionSignatures.has(curChars[i].avatar)) {
                        ensureCardBundleInstalled(i, { switchPreset: ctx.characterId === i });
                    }
                }
            }
            knownCharCount = curChars.length;
        }, 2500);
    } catch (err) {
        console.warn('[ST-Capsule v2] Event hook setup warning:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootExtensionV2);
} else {
    bootExtensionV2();
}
