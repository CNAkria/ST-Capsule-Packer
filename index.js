// ST Capsule Packer v1.2.0 — Full Compatibility with Luker (Android/Desktop) & SillyTavern
const EXT_ID = 'ST-Capsule-Packer';

// Self-inject critical fallback CSS so hot-install in Luker works even before style.css is reloaded
function ensureCriticalStyles() {
    if (document.getElementById('stcap-critical-css')) return;
    const style = document.createElement('style');
    style.id = 'stcap-critical-css';
    style.textContent = `
      dialog.stcap-dialog { padding:0; margin:auto; border:none; background:transparent; width:min(920px,96vw); max-width:96vw; max-height:92dvh; color:#f2f2f7; z-index:2147483645; }
      dialog.stcap-dialog::backdrop { background:rgba(6,7,11,0.82); backdrop-filter:blur(6px); }
      .stcap-overlay-fallback { position:fixed !important; inset:0 !important; z-index:2147483645 !important; background:rgba(6,7,11,0.82); display:flex; align-items:center; justify-content:center; padding:10px; box-sizing:border-box; }
      .stcap-modal { width:100%; max-height:90dvh; display:flex; flex-direction:column; background:#101219; border:1px solid rgba(218,228,255,0.2); border-radius:14px; box-shadow:0 24px 64px rgba(0,0,0,0.85); color:#f2f2f7; overflow:hidden; box-sizing:border-box; }
      .stcap-body { padding:14px 16px; overflow-y:auto; -webkit-overflow-scrolling:touch; flex:1; display:flex; flex-direction:column; gap:12px; }
      .stcap-footer { padding:10px 16px; border-top:1px solid rgba(255,255,255,0.1); background:#0b0d12; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; }
      .stcap-trigger-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:8px 13px; min-height:38px; border-radius:8px; border:1px solid rgba(102,157,246,0.55); background:#1a1e2c; color:#f4f4f8 !important; font-weight:600; font-size:13px; cursor:pointer; }
    `;
    document.head.appendChild(style);
}

// ============================================================================
// Dynamic Host Module Bridge (Works on Luker + Vanilla SillyTavern safely)
// ============================================================================
let hostMods = null;

async function getHostMods() {
    if (hostMods) return hostMods;
    const safeImport = async (relPath) => {
        try {
            return await import(new URL(relPath, import.meta.url).href);
        } catch (e1) {
            try {
                const absPath = relPath.replace(/^(\.\.\/)+/, '/scripts/');
                return await import(absPath);
            } catch {
                return {};
            }
        }
    };

    const [extMod, pmMod, puMod, wiMod, openaiMod] = await Promise.all([
        safeImport('../../../extensions.js'),
        safeImport('../../../preset-manager.js'),
        safeImport('../../../power-user.js'),
        safeImport('../../../world-info.js'),
        safeImport('../../../openai.js'),
    ]);

    hostMods = { extMod, pmMod, puMod, wiMod, openaiMod };
    return hostMods;
}

function getCtx() {
    try {
        if (window.Luker?.getContext) return window.Luker.getContext() || {};
        if (window.SillyTavern?.getContext) return window.SillyTavern.getContext() || {};
        if (window.lukerContext) return window.lukerContext;
    } catch (e) {
        console.warn('[ST-Capsule] getContext fallback:', e);
    }
    return {};
}

function safeJsonClone(val, fallback = {}) {
    if (val === undefined || val === null) return fallback;
    try {
        return JSON.parse(JSON.stringify(val));
    } catch {
        return fallback;
    }
}

// ============================================================================
// Pure Browser PNG Chunk & GZIP Codec
// ============================================================================
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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

function crc32(bytes, start = 0, end = bytes.length) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function readUint32BE(buf, offset) {
    return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function writeUint32BE(buf, offset, val) {
    buf[offset] = (val >>> 24) & 0xff;
    buf[offset + 1] = (val >>> 16) & 0xff;
    buf[offset + 2] = (val >>> 8) & 0xff;
    buf[offset + 3] = val & 0xff;
}

function extractPngChunks(uint8) {
    for (let i = 0; i < 8; i++) {
        if (uint8[i] !== PNG_SIG[i]) throw new Error('Invalid PNG signature');
    }
    const chunks = [];
    let offset = 8;
    while (offset + 8 <= uint8.length) {
        const length = readUint32BE(uint8, offset);
        const name = String.fromCharCode(uint8[offset + 4], uint8[offset + 5], uint8[offset + 6], uint8[offset + 7]);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > uint8.length) break;
        chunks.push({ name, data: uint8.slice(dataStart, dataEnd) });
        offset = dataEnd + 4;
        if (name === 'IEND') break;
    }
    return chunks;
}

function encodePngChunks(chunks) {
    let total = 8;
    for (const ch of chunks) total += 12 + ch.data.length;
    const out = new Uint8Array(total);
    out.set(PNG_SIG, 0);
    let offset = 8;
    for (const ch of chunks) {
        writeUint32BE(out, offset, ch.data.length);
        for (let i = 0; i < 4; i++) out[offset + 4 + i] = ch.name.charCodeAt(i) & 0xff;
        out.set(ch.data, offset + 8);
        const crc = crc32(out, offset + 4, offset + 8 + ch.data.length);
        writeUint32BE(out, offset + 8 + ch.data.length, crc);
        offset += 12 + ch.data.length;
    }
    return out;
}

function makeTextChunk(keyword, asciiText) {
    const keyBytes = new Uint8Array(keyword.length);
    for (let i = 0; i < keyword.length; i++) keyBytes[i] = keyword.charCodeAt(i) & 0xff;
    const valBytes = new Uint8Array(asciiText.length);
    for (let i = 0; i < asciiText.length; i++) valBytes[i] = asciiText.charCodeAt(i) & 0xff;
    const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
    data.set(keyBytes, 0);
    data[keyBytes.length] = 0;
    data.set(valBytes, keyBytes.length + 1);
    return { name: 'tEXt', data };
}

function decodeTextChunk(data) {
    let nul = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) { nul = i; break; }
    }
    if (nul < 0) return null;
    let keyword = '';
    for (let i = 0; i < nul; i++) keyword += String.fromCharCode(data[i]);
    const textBytes = data.subarray(nul + 1);
    let text = '';
    const step = 32768;
    for (let i = 0; i < textBytes.length; i += step) {
        text += String.fromCharCode(...textBytes.subarray(i, i + step));
    }
    return { keyword, text };
}

function uint8ToBase64(uint8) {
    let bin = '';
    const step = 32768;
    for (let i = 0; i < uint8.length; i += step) {
        bin += String.fromCharCode(...uint8.subarray(i, i + step));
    }
    return btoa(bin);
}

function base64ToUint8(b64) {
    const clean = b64.replace(/\s+/g, '');
    const bin = atob(clean);
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

async function compressCapsulePayload(jsonStr) {
    const rawBytes = new TextEncoder().encode(jsonStr);
    if (typeof CompressionStream !== 'undefined') {
        try {
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            writer.write(rawBytes);
            writer.close();
            const compressedBuf = await new Response(cs.readable).arrayBuffer();
            return 'STCAP1:GZIP:' + uint8ToBase64(new Uint8Array(compressedBuf));
        } catch (err) {
            console.warn('[ST-Capsule] GZIP fallback to RAW:', err);
        }
    }
    return 'STCAP1:RAW:' + uint8ToBase64(rawBytes);
}

async function decompressCapsulePayload(payloadStr) {
    if (payloadStr.startsWith('STCAP1:GZIP:')) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('当前 WebView 内核不支持 GZIP 解压，请升级 Android System WebView 或使用 .stcapsule.json。');
        }
        const b64 = payloadStr.slice('STCAP1:GZIP:'.length);
        const compressed = base64ToUint8(b64);
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        const rawBuf = await new Response(ds.readable).arrayBuffer();
        return JSON.parse(new TextDecoder('utf-8').decode(rawBuf));
    }
    if (payloadStr.startsWith('STCAP1:RAW:')) {
        const b64 = payloadStr.slice('STCAP1:RAW:'.length);
        return JSON.parse(base64ToUtf8(b64));
    }
    if (payloadStr.trim().startsWith('{')) {
        return JSON.parse(payloadStr);
    }
    return JSON.parse(base64ToUtf8(payloadStr));
}

function buildCapsulePng(originalPngBytes, v2CardObj, capsulePayloadEncoded) {
    const chunks = extractPngChunks(originalPngBytes).filter(ch => {
        if (ch.name !== 'tEXt') return true;
        const dec = decodeTextChunk(ch.data);
        if (!dec) return true;
        const kw = dec.keyword.toLowerCase();
        return kw !== 'chara' && kw !== 'ccv3' && kw !== 'st_capsule';
    });

    const v2Str = JSON.stringify(v2CardObj);
    const v3Obj = JSON.parse(v2Str);
    v3Obj.spec = 'chara_card_v3';
    v3Obj.spec_version = '3.0';
    const v3Str = JSON.stringify(v3Obj);

    const iendIdx = chunks.findIndex(c => c.name === 'IEND');
    const insertAt = iendIdx >= 0 ? iendIdx : chunks.length;

    chunks.splice(
        insertAt,
        0,
        makeTextChunk('chara', utf8ToBase64(v2Str)),
        makeTextChunk('ccv3', utf8ToBase64(v3Str)),
        makeTextChunk('st_capsule', capsulePayloadEncoded),
    );
    return encodePngChunks(chunks);
}

async function parseAnyCapsuleOrCardFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isPng = buf.length > 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71;

    if (isPng) {
        const chunks = extractPngChunks(buf);
        let capsuleText = null;
        let ccv3Text = null;
        let charaText = null;
        for (const ch of chunks) {
            if (ch.name === 'tEXt') {
                const dec = decodeTextChunk(ch.data);
                if (!dec) continue;
                const kw = dec.keyword.toLowerCase();
                if (kw === 'st_capsule') capsuleText = dec.text;
                else if (kw === 'ccv3') ccv3Text = dec.text;
                else if (kw === 'chara') charaText = dec.text;
            }
        }
        if (capsuleText) {
            const capsule = await decompressCapsulePayload(capsuleText);
            capsule._raw_png_bytes = buf;
            return { type: 'capsule', capsule };
        }
        const cardJson = ccv3Text ? base64ToUtf8(ccv3Text) : (charaText ? base64ToUtf8(charaText) : null);
        if (!cardJson) throw new Error('该 PNG 中未检测到角色卡 (chara/ccv3) 或胶囊数据 (st_capsule)。');
        const card = JSON.parse(cardJson);
        return {
            type: 'card_only',
            capsule: {
                spec: 'st_capsule_v1',
                version: '1.2.0',
                exported_at: new Date().toISOString(),
                character: {
                    name: card?.data?.name || card?.name || file.name.replace(/\.png$/i, ''),
                    avatar: file.name,
                    card,
                },
                presets: { items: [] },
                regex: { global: [], scoped: card?.data?.extensions?.regex_scripts || [], preset: [] },
                tavern_helper: { global_scripts: [], character_scripts: card?.data?.extensions?.TavernHelper_scripts || [] },
                worldbooks: {
                    bindings: { primary: card?.data?.extensions?.world || null, extra: [], global: [], chat_bound: [] },
                    books: card?.data?.character_book ? [{
                        name: card.data.character_book.name || (card?.data?.name + '_embedded'),
                        roles: ['embedded'],
                        data: card.data.character_book,
                    }] : [],
                },
                chats: [],
                _raw_png_bytes: buf,
            },
        };
    }

    const text = new TextDecoder('utf-8').decode(buf);
    const parsed = JSON.parse(text);
    if (parsed.spec === 'st_capsule_v1') {
        return { type: 'capsule', capsule: parsed };
    }
    if (parsed.spec === 'chara_card_v2' || parsed.spec === 'chara_card_v3' || parsed.data?.name || parsed.first_mes !== undefined) {
        return {
            type: 'card_only',
            capsule: {
                spec: 'st_capsule_v1',
                version: '1.2.0',
                character: { name: parsed?.data?.name || parsed?.name || 'Character', card: parsed },
                presets: { items: [] },
                regex: { global: [], scoped: parsed?.data?.extensions?.regex_scripts || [], preset: [] },
                tavern_helper: { global_scripts: [], character_scripts: [] },
                worldbooks: { bindings: {}, books: [] },
                chats: [],
            },
        };
    }
    throw new Error('无法识别的文件格式，请选入 .capsule.png、普通角色卡 .png 或 .stcapsule.json。');
}

// ============================================================================
// Data Collectors & Native Luker Android Save Handoff
// ============================================================================
async function apiPost(url, body) {
    const ctx = getCtx();
    const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
    return await resp.json();
}

async function createFallbackPngBytes(label = 'ST') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 768;
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 768);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e1b4b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 768);
    g.fillStyle = '#669df6';
    g.font = 'bold 42px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(label || 'ST').slice(0, 12), 256, 384);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

async function fetchCharacterAvatarBytes(avatar) {
    if (avatar) {
        try {
            const resp = await fetch(`/characters/${encodeURIComponent(avatar)}`, { cache: 'no-store' });
            if (resp.ok) {
                const buf = new Uint8Array(await resp.arrayBuffer());
                if (buf.length > 8 && buf[0] === 137 && buf[1] === 80) return buf;
            }
        } catch (e) {
            console.warn('[ST-Capsule] Avatar fetch fallback:', e);
        }
    }
    return await createFallbackPngBytes(avatar || 'Card');
}

function buildStandardV2Card(charObj) {
    const data = safeJsonClone(charObj?.data, {});
    data.name = data.name || charObj?.name || '';
    data.description = data.description ?? charObj?.description ?? '';
    data.personality = data.personality ?? charObj?.personality ?? '';
    data.scenario = data.scenario ?? charObj?.scenario ?? '';
    data.first_mes = data.first_mes ?? charObj?.first_mes ?? '';
    data.mes_example = data.mes_example ?? charObj?.mes_example ?? '';
    data.creator_notes = data.creator_notes ?? charObj?.creatorcomment ?? '';
    data.tags = Array.isArray(data.tags) ? data.tags : (Array.isArray(charObj?.tags) ? safeJsonClone(charObj.tags, []) : []);
    data.alternate_greetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [];
    data.extensions = data.extensions || {};
    if (charObj?.fav !== undefined) data.extensions.fav = Boolean(charObj.fav);
    if (charObj?.talkativeness !== undefined) data.extensions.talkativeness = charObj.talkativeness;

    return {
        name: data.name,
        description: data.description,
        personality: data.personality,
        scenario: data.scenario,
        first_mes: data.first_mes,
        mes_example: data.mes_example,
        creatorcomment: data.creator_notes || '',
        avatar: 'none',
        chat: charObj?.chat || '',
        talkativeness: String(charObj?.talkativeness ?? '0.5'),
        fav: Boolean(charObj?.fav),
        tags: data.tags,
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data,
    };
}

function normalizeChatMessagesResponse(resp) {
    if (Array.isArray(resp)) return resp;
    if (resp && Array.isArray(resp.chat)) return resp.chat;
    if (resp && Array.isArray(resp.messages)) return resp.messages;
    return null;
}

async function inspectCharacterWorkspace(chid) {
    const ctx = getCtx();
    const { extMod, pmMod, puMod, wiMod, openaiMod } = await getHostMods();
    const extension_settings = extMod.extension_settings || ctx.extensionSettings || {};
    const power_user = puMod.power_user || ctx.powerUserSettings || {};
    const world_info = wiMod.world_info || {};
    const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;

    const characters = ctx.characters || [];
    if (chid === undefined || chid === null || !characters[chid]) {
        return null;
    }
    if (typeof ctx.unshallowCharacter === 'function') {
        try { await ctx.unshallowCharacter(chid); } catch (e) { console.warn('[ST-Capsule] unshallow warning:', e); }
    }
    const charObj = characters[chid];
    const avatar = charObj.avatar || '';
    const charKey = String(avatar).replace(/\.png$/i, '');

    // 1. Worldbooks discovery (Supports both Luker & Vanilla SillyTavern)
    let allWorldList = [];
    try {
        const wiResp = await apiPost('/api/worldinfo/list', {});
        if (Array.isArray(wiResp)) {
            allWorldList = wiResp.map(w => (typeof w === 'string' ? w : (w?.file_id || w?.name))).filter(Boolean);
        }
    } catch {
        if (Array.isArray(wiMod.world_names)) allWorldList = [...wiMod.world_names];
    }

    const roleMap = new Map();
    const addBookRole = (bookName, role) => {
        if (!bookName || typeof bookName !== 'string') return;
        if (!roleMap.has(bookName)) roleMap.set(bookName, new Set());
        roleMap.get(bookName).add(role);
    };

    const primaryBook = charObj?.data?.extensions?.world || charObj?.world || null;
    if (primaryBook) addBookRole(primaryBook, '角色主世界书');

    // Luker getCharaAuxWorlds support
    if (typeof wiMod.getCharaAuxWorlds === 'function') {
        try {
            const aux = wiMod.getCharaAuxWorlds(avatar) || wiMod.getCharaAuxWorlds(charKey) || [];
            if (Array.isArray(aux)) aux.forEach(b => addBookRole(b, '角色附加世界书'));
        } catch {}
    }

    const charLoreArr = world_info?.charLore || [];
    const extraEntry = Array.isArray(charLoreArr) ? charLoreArr.find(e => e.name === charKey || e.name === avatar) : null;
    if (Array.isArray(extraEntry?.extraBooks)) {
        extraEntry.extraBooks.forEach(b => addBookRole(b, '角色附加世界书'));
    }

    const globalBooks = world_info?.globalSelect || wiMod.selected_world_info || [];
    if (Array.isArray(globalBooks)) {
        globalBooks.forEach(b => addBookRole(b, '全局启用世界书'));
    }

    // Luker getChatWorldInfoNames support
    if (ctx.characterId == chid && typeof wiMod.getChatWorldInfoNames === 'function') {
        try {
            const cw = wiMod.getChatWorldInfoNames();
            if (Array.isArray(cw)) cw.forEach(b => addBookRole(b, '当前聊天绑定'));
        } catch {}
    }

    const wiLocks = extension_settings?.worldInfoPresets;
    const lockedPresetName = wiLocks?.characterLocks?.[avatar] || wiLocks?.characterLocks?.[charKey];
    if (lockedPresetName && Array.isArray(wiLocks?.presetList)) {
        const foundPreset = wiLocks.presetList.find(p => p.name === lockedPresetName);
        if (Array.isArray(foundPreset?.worldList)) {
            foundPreset.worldList.forEach(b => addBookRole(b, 'WorldInfoLocks绑定'));
        }
    }

    const userAvatar = power_user?.personas ? Object.keys(power_user.personas).find(k => power_user.personas[k] === ctx.name1) : null;
    const personaBook = userAvatar ? power_user?.persona_descriptions?.[userAvatar]?.lorebook : null;
    if (personaBook) addBookRole(personaBook, '当前人设世界书');

    // 2. Chats discovery
    let chatFiles = [];
    try {
        const chatsResp = await apiPost('/api/characters/chats', { avatar_url: avatar });
        if (Array.isArray(chatsResp)) {
            chatFiles = chatsResp.map(c => {
                const fileName = c.file_name || '';
                const fileId = c.file_id || fileName.replace(/\.jsonl$/i, '');
                if (c.chat_metadata?.world_info) {
                    addBookRole(c.chat_metadata.world_info, '聊天分支绑定');
                }
                return {
                    file_name: fileName.endsWith('.jsonl') ? fileName : `${fileName}.jsonl`,
                    file_id: fileId,
                    message_count: c.chat_items ?? c.message_count ?? 0,
                    file_size: c.file_size || '',
                    last_mes: c.last_mes || '',
                    is_active: fileId === charObj.chat,
                };
            }).filter(c => c.file_id);
        }
    } catch (e) {
        console.warn('[ST-Capsule] characters/chats warning:', e);
    }

    if (ctx.characterId == chid && ctx.chatMetadata?.world_info) {
        addBookRole(ctx.chatMetadata.world_info, '当前聊天绑定');
    }

    const worldbookOptions = [];
    for (const [name, roles] of roleMap.entries()) {
        worldbookOptions.push({ name, roles: [...roles], preselected: true });
    }
    for (const name of allWorldList) {
        if (!roleMap.has(name)) {
            worldbookOptions.push({ name, roles: [], preselected: false });
        }
    }

    // 3. Presets discovery (Luker + Vanilla ST safe)
    const pm = typeof getPresetManager === 'function' ? getPresetManager() : null;
    let activePresetName = '';
    let presetNames = [];
    try {
        if (pm) {
            activePresetName = pm.getSelectedPresetName?.() || '';
            const allPresets = pm.getPresetList?.();
            if (allPresets?.preset_names) {
                presetNames = Array.isArray(allPresets.preset_names)
                    ? [...allPresets.preset_names]
                    : Object.keys(allPresets.preset_names);
            }
        }
    } catch (e) {
        console.warn('[ST-Capsule] Preset list warning:', e);
    }
    if (!activePresetName && openaiMod?.oai_settings?.preset_settings_openai) {
        activePresetName = String(openaiMod.oai_settings.preset_settings_openai);
    }
    if (activePresetName && !presetNames.includes(activePresetName)) {
        presetNames.unshift(activePresetName);
    }

    // 4. Regex & TavernHelper discovery
    const globalRegex = Array.isArray(extension_settings?.regex) ? extension_settings.regex : [];
    const scopedRegex = Array.isArray(charObj?.data?.extensions?.regex_scripts) ? charObj.data.extensions.regex_scripts : [];
    let presetRegex = [];
    try {
        const activePresetData = pm?.getPresetSettings?.(activePresetName) || openaiMod?.oai_settings;
        if (Array.isArray(activePresetData?.extensions?.regex_scripts)) {
            presetRegex = activePresetData.extensions.regex_scripts;
        }
    } catch {}

    const thGlobalScripts = extension_settings?.tavern_helper?.script?.scripts || [];
    const thCharScripts = charObj?.data?.extensions?.TavernHelper_scripts || [];

    return {
        chid,
        charObj,
        avatar,
        charKey,
        name: charObj.name || charKey || 'Character',
        worldbookOptions,
        chatFiles,
        activePresetName,
        presetNames,
        globalRegex,
        scopedRegex,
        presetRegex,
        thGlobalScripts: Array.isArray(thGlobalScripts) ? thGlobalScripts : Object.values(thGlobalScripts || {}),
        thCharScripts: Array.isArray(thCharScripts) ? thCharScripts : Object.values(thCharScripts || {}),
    };
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

function canShareFileMobile() {
    try {
        if (typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined') {
            const testFile = new File(['1'], 't.png', { type: 'image/png' });
            return navigator.canShare({ files: [testFile] });
        }
    } catch {}
    return false;
}

async function stageFileOnLocalServer(uint8Bytes, extSuffix) {
    try {
        const asciiTempName = `stcap_${Date.now()}${extSuffix}`;
        const b64 = uint8ToBase64(uint8Bytes);
        const resp = await apiPost('/api/files/upload', {
            name: asciiTempName,
            data: b64,
        });
        if (resp?.path) {
            const relPath = resp.path.startsWith('/') ? resp.path : `/${resp.path}`;
            const fullUrl = new URL(relPath, window.location.origin).href;
            return { ok: true, relPath, fullUrl, asciiTempName };
        }
    } catch (err) {
        console.warn('[ST-Capsule] /api/files/upload staging warning:', err);
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

async function saveGeneratedPayload({ bytes, filename, mimeType, extSuffix, useMobileShare = false }) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([u8], { type: mimeType });

    // Always stage onto SillyTavern/Luker's /user/files/ first so there is zero JNI size limit
    const staged = await stageFileOnLocalServer(u8, extSuffix);

    // 1. Explicit Web Share sheet if user clicked Share button
    if (useMobileShare && navigator.share && typeof File !== 'undefined') {
        try {
            const fileObj = new File([blob], filename, { type: mimeType });
            if (!navigator.canShare || navigator.canShare({ files: [fileObj] })) {
                await navigator.share({ title: filename, files: [fileObj] });
                return { via: 'share', blob, staged };
            }
        } catch (err) {
            if (err?.name === 'AbortError') return { via: 'cancelled', blob, staged };
            console.warn('[ST-Capsule] Share fallback:', err);
        }
    }

    // 2. Preferred Luker Android Stream Bridge (MainActivity.kt -> saveFileFromUrl -> launchSafPickerFor)
    // Passes only a tiny JSON string across JNI, avoiding WebView @JavascriptInterface multi-MB dataUrl drops!
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
            return { via: 'luker-stream-saf', blob, staged };
        } catch (err) {
            console.warn('[ST-Capsule] saveFileFromUrl fallback:', err);
        }
    }

    // 3. Older Luker Android APK: if file <= 1.2 MB use saveFileFromDataUrl; if larger, use real HTTP URL to hit WebView DownloadListener!
    if (window.LukerAndroid && typeof window.LukerAndroid.saveFileFromDataUrl === 'function') {
        if (u8.byteLength <= 1_200_000) {
            try {
                const dataUrl = `data:${mimeType};base64,${uint8ToBase64(u8)}`;
                window.LukerAndroid.saveFileFromDataUrl(dataUrl, filename, mimeType);
                return { via: 'luker-dataurl-saf', blob, staged };
            } catch (err) {
                console.warn('[ST-Capsule] saveFileFromDataUrl fallback:', err);
            }
        }
        if (staged.ok) {
            triggerHttpAnchorDownload(staged.fullUrl, filename);
            return { via: 'luker-http-download', blob, staged };
        }
    }

    // 4. Standard Browser Download (prefer real staged HTTP URL if available, else Blob URL)
    if (staged.ok) {
        triggerHttpAnchorDownload(staged.fullUrl, filename);
        return { via: 'http-download', blob, staged };
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
    }, 15000);
    return { via: 'blob-download', blob, staged };
}

// ============================================================================
// Top-Layer <dialog> Modal UI (Guaranteed Visible Above All Luker Layers)
// ============================================================================
function createTopLayerModalShell(initialTab) {
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
            <span class="stcap-title">📦 酒馆全量胶囊工作台</span>
            <span class="stcap-neon-tag">${isLukerAndroidApp() ? 'Luker Android 直连' : 'ST-CAPSULE v1.2'}</span>
          </div>
          <button type="button" class="stcap-close" title="关闭">✕</button>
        </div>
        <div class="stcap-tabs">
          <button type="button" class="stcap-tab ${initialTab === 'export' ? 'active' : ''}" data-tab="export">📤 绑定打包导出</button>
          <button type="button" class="stcap-tab ${initialTab === 'import' ? 'active' : ''}" data-tab="import">📥 读取 / 还原胶囊</button>
        </div>
        <div class="stcap-body" id="stcap-body">
          <div style="padding:24px;text-align:center;color:#8ab4f8;">正在打开胶囊工作台...</div>
        </div>
        <div class="stcap-footer" id="stcap-footer"></div>
      </div>
    `;

    document.body.appendChild(rootEl);
    if (supportsDialog) {
        try {
            rootEl.showModal();
        } catch {
            rootEl.className = 'stcap-overlay-fallback';
        }
    }

    const closeModal = () => {
        try { if (typeof rootEl.close === 'function' && rootEl.open) rootEl.close(); } catch {}
        rootEl.remove();
    };

    rootEl.querySelector('.stcap-close').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
    });
    rootEl.addEventListener('click', (e) => {
        if (e.target === rootEl) closeModal();
    });

    return { rootEl, closeModal };
}

async function openCapsuleModal(initialTab = 'export') {
    ensureCriticalStyles();
    const { rootEl } = createTopLayerModalShell(initialTab);
    const bodyEl = rootEl.querySelector('#stcap-body');
    const footerEl = rootEl.querySelector('#stcap-footer');

    const ctx = getCtx();
    const characters = ctx.characters || [];
    let currentChid = ctx.characterId !== undefined && ctx.characterId !== null && characters[ctx.characterId]
        ? Number(ctx.characterId)
        : (characters.length > 0 ? 0 : -1);

    let activeTab = initialTab;
    let inspected = null;

    rootEl.querySelectorAll('.stcap-tab').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            activeTab = btn.dataset.tab;
            rootEl.querySelectorAll('.stcap-tab').forEach(b => b.classList.toggle('active', b === btn));
            if (activeTab === 'export') await renderExportTab();
            else renderImportTab();
        });
    });

    async function renderExportTab() {
        try {
            if (characters.length === 0 || currentChid < 0) {
                bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#94a3b8;">当前酒馆中暂无可导出的角色卡（如果你刚打开酒馆，请先点进任意角色或等待角色列表加载完成）。</div>`;
                footerEl.innerHTML = '';
                return;
            }
            bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#8ab4f8;">正在扫描角色绑定的预设、正则、多世界书与全部聊天分支...</div>`;
            footerEl.innerHTML = '';

            inspected = await inspectCharacterWorkspace(currentChid);
            if (!inspected) {
                bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#f87171;">无法读取角色索引 #${currentChid}。</div>`;
                return;
            }

            const charOptionsHtml = characters.map((c, idx) =>
                `<option value="${idx}" ${idx === currentChid ? 'selected' : ''}>${escapeHtml(c.name || c.avatar)} (${escapeHtml(c.avatar || idx)})</option>`
            ).join('');

            const wbItemsHtml = inspected.worldbookOptions.map(wb => `
              <label class="stcap-item stcap-wb-row" data-name="${escapeHtml(wb.name.toLowerCase())}">
                <input type="checkbox" class="stcap-wb-chk" value="${escapeHtml(wb.name)}" ${wb.preselected ? 'checked' : ''} />
                <span class="stcap-item-label" title="${escapeHtml(wb.name)}">${escapeHtml(wb.name)}</span>
                ${wb.roles.length ? `<span class="stcap-badge warn">${escapeHtml(wb.roles.join(' · '))}</span>` : `<span class="stcap-item-sub">未绑定</span>`}
              </label>
            `).join('');

            const presetItemsHtml = inspected.presetNames.map(pName => {
                const isAct = pName === inspected.activePresetName;
                return `
                  <label class="stcap-item">
                    <input type="checkbox" class="stcap-preset-chk" value="${escapeHtml(pName)}" ${isAct ? 'checked' : ''} />
                    <span class="stcap-item-label" title="${escapeHtml(pName)}">${escapeHtml(pName)}</span>
                    ${isAct ? `<span class="stcap-badge">当前激活</span>` : ''}
                  </label>
                `;
            }).join('');

            const chatItemsHtml = inspected.chatFiles.length > 0
                ? inspected.chatFiles.map(cf => `
                  <label class="stcap-item">
                    <input type="checkbox" class="stcap-chat-chk" value="${escapeHtml(cf.file_id)}" checked />
                    <span class="stcap-item-label" title="${escapeHtml(cf.file_id)}">${escapeHtml(cf.file_id)}</span>
                    <span class="stcap-item-sub">${cf.is_active ? '★当前 · ' : ''}${cf.message_count} 条 ${cf.file_size ? `· ${escapeHtml(cf.file_size)}` : ''}</span>
                  </label>
                `).join('')
                : `<div style="color:#64748b;font-size:12px;padding:8px;">该角色暂无已保存的历史聊天记录 (.jsonl)</div>`;

            bodyEl.innerHTML = `
              <div class="stcap-char-bar">
                <img class="stcap-avatar-preview" src="/characters/${encodeURIComponent(inspected.avatar)}" onerror="this.style.display='none'" />
                <div style="flex:1;min-width:200px;">
                  <div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">选择要打包的角色卡（已自动勾选其绑定的世界书、预设、正则与全部聊天记录）</div>
                  <select class="stcap-select" id="stcap-char-select">${charOptionsHtml}</select>
                </div>
              </div>

              <div class="stcap-grid">
                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">🌍 多本世界书 <span class="stcap-badge">${inspected.worldbookOptions.filter(w => w.preselected).length} 绑定 / 共 ${inspected.worldbookOptions.length}</span></span>
                    <div class="stcap-mini-actions">
                      <button type="button" class="stcap-mini-btn" id="stcap-wb-bound">仅绑定</button>
                      <button type="button" class="stcap-mini-btn" id="stcap-wb-all">全选</button>
                      <button type="button" class="stcap-mini-btn" id="stcap-wb-none">清空</button>
                    </div>
                  </div>
                  <input type="text" class="stcap-search" id="stcap-wb-search" placeholder="搜索世界书名称（可勾选任意多本一起打包）..." />
                  <div class="stcap-list" id="stcap-wb-list">${wbItemsHtml || '<div style="color:#64748b;font-size:12px;padding:6px;">暂无世界书</div>'}</div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">💬 所有聊天记录 <span class="stcap-badge">${inspected.chatFiles.length} 个分支</span></span>
                    <div class="stcap-mini-actions">
                      <button type="button" class="stcap-mini-btn" id="stcap-chat-all">全选</button>
                      <button type="button" class="stcap-mini-btn" id="stcap-chat-none">清空</button>
                    </div>
                  </div>
                  <label class="stcap-item" style="background:rgba(102,157,246,0.1);border:1px solid rgba(102,157,246,0.28);">
                    <input type="checkbox" id="stcap-slim-chat-media" checked />
                    <span class="stcap-item-label" title="剥离聊天楼层内嵌的生成插图与音频 Base64，100%保留文字、思维链、Swipes与变量">🧹 瘦身：剥离聊天内嵌大图/语音 Base64</span>
                  </label>
                  <div class="stcap-list">${chatItemsHtml}</div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">🎛️ 预设 (Presets) <span class="stcap-badge">${escapeHtml(ctx.mainApi || 'Chat')}</span></span>
                  </div>
                  <div class="stcap-list">
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-live-preset" checked />
                      <span class="stcap-item-label">当前实时生效预设参数 (含卡绑定预设)</span>
                    </label>
                    ${presetItemsHtml}
                  </div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">🧬 正则 · 酒馆助手 · 人设</span>
                  </div>
                  <div class="stcap-list">
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-global-regex" checked />
                      <span class="stcap-item-label">全局正则脚本 (Global Regex)</span>
                      <span class="stcap-badge">${inspected.globalRegex.length} 条</span>
                    </label>
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-scoped-regex" checked />
                      <span class="stcap-item-label">角色局部正则 (Character Regex)</span>
                      <span class="stcap-badge">${inspected.scopedRegex.length} 条</span>
                    </label>
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-preset-regex" checked />
                      <span class="stcap-item-label">预设绑定正则 (Preset Regex)</span>
                      <span class="stcap-badge">${inspected.presetRegex.length} 条</span>
                    </label>
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-th-scripts" checked />
                      <span class="stcap-item-label">酒馆助手脚本 (TavernHelper)</span>
                      <span class="stcap-badge">全局 ${inspected.thGlobalScripts.length} · 角色 ${inspected.thCharScripts.length}</span>
                    </label>
                    <label class="stcap-item">
                      <input type="checkbox" id="stcap-inc-persona" checked />
                      <span class="stcap-item-label">当前用户名与人设描述 ({{user}})</span>
                      <span class="stcap-item-sub">${escapeHtml(ctx.name1 || '')}</span>
                    </label>
                  </div>
                </div>
              </div>
            `;

            const showMobileShare = canShareFileMobile();
            footerEl.innerHTML = `
              <div class="stcap-status" id="stcap-status">
                ${isLukerAndroidApp()
                    ? '已识别 Luker 安卓客户端：点击下方导出将直接唤起安卓系统原生文件保存框。'
                    : '就绪：单卡 PNG 模式会将所有数据 GZIP 高压缩写入 PNG 的 st_capsule 块。'}
              </div>
              <div class="stcap-export-btns">
                <button type="button" class="stcap-action-btn secondary" id="stcap-btn-json">📄 导出独立文件 (.stcapsule.json)</button>
                <button type="button" class="stcap-action-btn" id="stcap-btn-png">🖼️ 绑定在一张卡里导出 (.capsule.png)</button>
                ${showMobileShare ? `<button type="button" class="stcap-action-btn" id="stcap-btn-share" style="background:linear-gradient(135deg,#059669,#0284c7);">📲 系统转发分享 (.capsule.png)</button>` : ''}
              </div>
            `;

            bodyEl.querySelector('#stcap-char-select').addEventListener('change', async (e) => {
                currentChid = Number(e.target.value);
                await renderExportTab();
            });

            bodyEl.querySelector('#stcap-wb-search').addEventListener('input', (e) => {
                const q = e.target.value.trim().toLowerCase();
                bodyEl.querySelectorAll('.stcap-wb-row').forEach(row => {
                    row.style.display = !q || row.dataset.name.includes(q) ? '' : 'none';
                });
            });

            bodyEl.querySelector('#stcap-wb-all').addEventListener('click', () => {
                bodyEl.querySelectorAll('.stcap-wb-chk').forEach(c => { if (c.closest('.stcap-wb-row').style.display !== 'none') c.checked = true; });
            });
            bodyEl.querySelector('#stcap-wb-none').addEventListener('click', () => {
                bodyEl.querySelectorAll('.stcap-wb-chk').forEach(c => { c.checked = false; });
            });
            bodyEl.querySelector('#stcap-wb-bound').addEventListener('click', () => {
                const boundSet = new Set(inspected.worldbookOptions.filter(w => w.preselected).map(w => w.name));
                bodyEl.querySelectorAll('.stcap-wb-chk').forEach(c => { c.checked = boundSet.has(c.value); });
            });

            bodyEl.querySelector('#stcap-chat-all').addEventListener('click', () => {
                bodyEl.querySelectorAll('.stcap-chat-chk').forEach(c => { c.checked = true; });
            });
            bodyEl.querySelector('#stcap-chat-none').addEventListener('click', () => {
                bodyEl.querySelectorAll('.stcap-chat-chk').forEach(c => { c.checked = false; });
            });

            footerEl.querySelector('#stcap-btn-png').addEventListener('click', () => runExport('png', false));
            footerEl.querySelector('#stcap-btn-json').addEventListener('click', () => runExport('json', false));
            footerEl.querySelector('#stcap-btn-share')?.addEventListener('click', () => runExport('png', true));
        } catch (err) {
            console.error('[ST-Capsule] renderExportTab error:', err);
            bodyEl.innerHTML = `<div style="padding:20px;color:#fca5a5;background:rgba(127,29,29,0.25);border-radius:8px;">加载角色打包面板出错：${escapeHtml(err?.message || String(err))}</div>`;
        }
    }

    async function runExport(mode, useMobileShare = false) {
        const statusEl = footerEl.querySelector('#stcap-status');
        const btnPng = footerEl.querySelector('#stcap-btn-png');
        const btnJson = footerEl.querySelector('#stcap-btn-json');
        const btnShare = footerEl.querySelector('#stcap-btn-share');
        btnPng.disabled = true;
        btnJson.disabled = true;
        if (btnShare) btnShare.disabled = true;

        try {
            const { pmMod, puMod, wiMod, openaiMod } = await getHostMods();
            const power_user = puMod.power_user || ctx.powerUserSettings || {};
            const world_info = wiMod.world_info || {};
            const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;

            const selectedWbs = [...bodyEl.querySelectorAll('.stcap-wb-chk:checked')].map(c => c.value);
            const selectedChats = [...bodyEl.querySelectorAll('.stcap-chat-chk:checked')].map(c => c.value);
            const slimChatMedia = Boolean(bodyEl.querySelector('#stcap-slim-chat-media')?.checked);
            const selectedPresets = [...bodyEl.querySelectorAll('.stcap-preset-chk:checked')].map(c => c.value);
            const incLivePreset = bodyEl.querySelector('#stcap-inc-live-preset')?.checked;

            const incGlobalRegex = bodyEl.querySelector('#stcap-inc-global-regex')?.checked;
            const incScopedRegex = bodyEl.querySelector('#stcap-inc-scoped-regex')?.checked;
            const incPresetRegex = bodyEl.querySelector('#stcap-inc-preset-regex')?.checked;
            const incThScripts = bodyEl.querySelector('#stcap-inc-th-scripts')?.checked;
            const incPersona = bodyEl.querySelector('#stcap-inc-persona')?.checked;

            statusEl.textContent = `正在读取头像与角色卡基础结构...`;
            const pngBytes = await fetchCharacterAvatarBytes(inspected.avatar);
            const v2Card = buildStandardV2Card(inspected.charObj);

            // 1. Fetch selected worldbooks
            const booksOut = [];
            for (let i = 0; i < selectedWbs.length; i++) {
                const wbName = selectedWbs[i];
                statusEl.textContent = `正在打包世界书 (${i + 1}/${selectedWbs.length}): ${wbName}...`;
                try {
                    const wbData = await apiPost('/api/worldinfo/get', { name: wbName });
                    if (wbData && typeof wbData === 'object') {
                        const opt = inspected.worldbookOptions.find(o => o.name === wbName);
                        booksOut.push({
                            name: wbName,
                            roles: opt?.roles || [],
                            entry_count: Object.keys(wbData?.entries || {}).length,
                            data: wbData,
                        });
                    }
                } catch (err) {
                    console.warn('[ST-Capsule] Failed reading worldbook:', wbName, err);
                }
            }

            const primaryBookName = v2Card.data?.extensions?.world;
            const primaryFound = booksOut.find(b => b.name === primaryBookName);
            if (primaryFound?.data?.entries && !v2Card.data.character_book) {
                const entriesArr = Object.values(primaryFound.data.entries).map((e, idx) => ({
                    id: e.uid ?? idx,
                    keys: Array.isArray(e.key) ? e.key : [],
                    secondary_keys: Array.isArray(e.keysecondary) ? e.keysecondary : [],
                    comment: e.comment || '',
                    content: e.content || '',
                    constant: Boolean(e.constant),
                    selective: Boolean(e.selective),
                    insertion_order: e.order ?? 100,
                    enabled: !e.disable,
                    position: e.position === 0 ? 'before_char' : 'after_char',
                    extensions: e,
                }));
                v2Card.data.character_book = { name: primaryBookName, entries: entriesArr };
            }

            // 2. Fetch presets (including Luker live / card-bound preset fallback)
            statusEl.textContent = `正在提取预设配置...`;
            const pm = typeof getPresetManager === 'function' ? getPresetManager() : null;
            const presetItems = [];
            const seenPresetNames = new Set();

            for (const pName of selectedPresets) {
                try {
                    const pData = pm?.getPresetSettings?.(pName) || pm?.getCompletionPresetByName?.(pName);
                    if (pData) {
                        presetItems.push({
                            name: pName,
                            is_active: pName === inspected.activePresetName,
                            data: safeJsonClone(pData, {}),
                        });
                        seenPresetNames.add(pName);
                    }
                } catch (e) {
                    console.warn('[ST-Capsule] Preset fetch warning:', pName, e);
                }
            }

            if (incLivePreset && openaiMod?.oai_settings && (!inspected.activePresetName || !seenPresetNames.has(inspected.activePresetName))) {
                const liveName = inspected.activePresetName || '当前实时运行预设';
                presetItems.unshift({
                    name: liveName,
                    is_active: true,
                    data: safeJsonClone(openaiMod.oai_settings, {}),
                });
            }

            const stripMsgMediaInPlace = (msgs) => {
                if (!slimChatMedia || !Array.isArray(msgs)) return msgs;
                const dataUriRe = /data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=\s]{1024,}/g;
                return msgs.map(raw => {
                    if (!raw || typeof raw !== 'object') return raw;
                    const m = safeJsonClone(raw, raw);
                    if (typeof m.mes === 'string' && m.mes.length > 1200) {
                        m.mes = m.mes.replace(dataUriRe, '[inline-media-omitted]');
                    }
                    if (Array.isArray(m.swipes)) {
                        m.swipes = m.swipes.map(s => (typeof s === 'string' && s.length > 1200 ? s.replace(dataUriRe, '[inline-media-omitted]') : s));
                    }
                    if (m.extra && typeof m.extra === 'object') {
                        delete m.extra.image;
                        delete m.extra.inline_image;
                        delete m.extra.audio;
                        if (Array.isArray(m.extra.media)) delete m.extra.media;
                        if (Array.isArray(m.extra.image_swipes)) delete m.extra.image_swipes;
                    }
                    return m;
                });
            };

            // 3. Fetch all selected chat histories
            const chatsOut = [];
            for (let i = 0; i < selectedChats.length; i++) {
                const chatId = selectedChats[i];
                statusEl.textContent = `正在提取聊天记录 (${i + 1}/${selectedChats.length}): ${chatId}...`;
                try {
                    const rawResp = await apiPost('/api/chats/get', {
                        ch_name: inspected.name,
                        file_name: chatId,
                        avatar_url: inspected.avatar,
                    });
                    let messages = normalizeChatMessagesResponse(rawResp);
                    if (!messages && chatId === inspected.charObj.chat && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
                        messages = [{ user_name: ctx.name1, character_name: inspected.name, chat_metadata: safeJsonClone(ctx.chatMetadata, {}) }, ...safeJsonClone(ctx.chat, [])];
                    }
                    if (Array.isArray(messages) && messages.length > 0) {
                        messages = stripMsgMediaInPlace(messages);
                        const metaObj = messages[0]?.chat_metadata ? messages[0] : { chat_metadata: {} };
                        const msgCount = messages.filter(m => !m.chat_metadata || m.mes !== undefined).length;
                        chatsOut.push({
                            file_id: chatId,
                            file_name: `${chatId}.jsonl`,
                            is_active_chat: chatId === inspected.charObj.chat,
                            message_count: msgCount,
                            chat_metadata: metaObj.chat_metadata || {},
                            messages,
                        });
                    }
                } catch (err) {
                    console.warn('[ST-Capsule] Chat fetch warning:', chatId, err);
                }
            }

            // If character has unsaved in-memory chat messages and no .jsonl file yet, include current memory chat
            if (chatsOut.length === 0 && ctx.characterId == inspected.chid && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
                const memMsgs = [
                    { user_name: ctx.name1 || 'User', character_name: inspected.name, chat_metadata: safeJsonClone(ctx.chatMetadata, {}) },
                    ...safeJsonClone(ctx.chat, []),
                ];
                chatsOut.push({
                    file_id: `${inspected.name}_current`,
                    file_name: `${inspected.name}_current.jsonl`,
                    is_active_chat: true,
                    message_count: ctx.chat.length,
                    chat_metadata: safeJsonClone(ctx.chatMetadata, {}),
                    messages: memMsgs,
                });
            }

            // 4. Persona snapshot
            let personaOut = null;
            if (incPersona) {
                const userAvatar = power_user?.personas
                    ? Object.keys(power_user.personas).find(k => power_user.personas[k] === ctx.name1)
                    : null;
                const descObj = userAvatar ? power_user?.persona_descriptions?.[userAvatar] : null;
                personaOut = {
                    user_name: ctx.name1 || '',
                    user_avatar: userAvatar || '',
                    description: descObj?.description || power_user?.persona_description || '',
                    lorebook: descObj?.lorebook || '',
                };
            }

            const auxExtraBooks = inspected.worldbookOptions
                .filter(w => w.roles.includes('角色附加世界书'))
                .map(w => w.name);

            const capsuleObj = {
                spec: 'st_capsule_v1',
                version: '1.2.0',
                exported_at: new Date().toISOString(),
                source: isLukerAndroidApp() ? 'Luker-Android-ST-Capsule-Packer' : 'SillyTavern-ST-Capsule-Packer',
                character: {
                    name: inspected.name,
                    avatar: inspected.avatar,
                    card: v2Card,
                    ...(mode === 'json' ? { avatar_png_base64: uint8ToBase64(pngBytes) } : {}),
                },
                persona: personaOut,
                presets: {
                    active_preset_name: inspected.activePresetName,
                    items: presetItems,
                    power_user_context: safeJsonClone({
                        instruct: power_user?.instruct || null,
                        context: power_user?.context || null,
                        sysprompt: power_user?.sysprompt || null,
                        reasoning: power_user?.reasoning || null,
                    }, {}),
                },
                regex: {
                    global: incGlobalRegex ? safeJsonClone(inspected.globalRegex, []) : [],
                    scoped: incScopedRegex ? safeJsonClone(inspected.scopedRegex, []) : [],
                    preset: incPresetRegex ? safeJsonClone(inspected.presetRegex, []) : [],
                },
                tavern_helper: {
                    global_scripts: incThScripts ? safeJsonClone(inspected.thGlobalScripts, []) : [],
                    character_scripts: incThScripts ? safeJsonClone(inspected.thCharScripts, []) : [],
                },
                worldbooks: {
                    bindings: {
                        primary: v2Card.data?.extensions?.world || null,
                        extra: auxExtraBooks,
                        global: safeJsonClone(world_info?.globalSelect || [], []),
                    },
                    books: booksOut,
                },
                chats: chatsOut,
            };

            const safeBase = sanitizeDownloadName(inspected.name);
            const jsonStr = JSON.stringify(capsuleObj, null, mode === 'json' ? 2 : 0);

            const renderManualSaveBox = (saved, fileName, mimeType, mb) => {
                let oldBox = bodyEl.querySelector('#stcap-result-box');
                if (oldBox) oldBox.remove();
                const box = document.createElement('div');
                box.id = 'stcap-result-box';
                box.style.cssText = 'padding:12px;border-radius:10px;background:rgba(6,78,59,0.35);border:1px solid rgba(52,211,153,0.55);display:flex;flex-direction:column;gap:8px;';
                box.innerHTML = `
                  <div style="font-size:13px;font-weight:700;color:#6ee7b7;">
                    ✅ 打包完成：${escapeHtml(fileName)} (${mb} MB · 通道: ${escapeHtml(saved.via)})
                  </div>
                  <div style="font-size:11.5px;color:#d1fae5;line-height:1.5;">
                    ${saved.staged?.ok
                        ? `文件已同步写入酒馆本地目录：<code>data/default-user${escapeHtml(saved.staged.relPath)}</code>。<br/>如果手机系统未自动弹出「选择保存位置」，请直接点下面任意一种保底方式保存：`
                        : `如果未自动弹出保存框，请点击下方按钮重试保存：`}
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${saved.staged?.ok && window.LukerAndroid?.saveFileFromUrl ? `<button type="button" class="stcap-mini-btn" id="stcap-retry-saf" style="padding:6px 10px;border-color:#34d399;color:#fff;font-weight:600;">📂 重新唤起安卓选择保存位置</button>` : ''}
                    ${saved.staged?.ok ? `<a href="${escapeHtml(saved.staged.fullUrl)}" download="${escapeHtml(fileName)}" class="stcap-mini-btn" style="padding:6px 10px;border-color:#60a5fa;color:#fff;text-decoration:none;font-weight:600;">⬇️ 直链下载到手机 Download 栏</a>` : ''}
                    ${saved.staged?.ok ? `<a href="${escapeHtml(saved.staged.fullUrl)}" target="_blank" rel="noopener" class="stcap-mini-btn" style="padding:6px 10px;color:#e2e8f0;text-decoration:none;">🌐 新窗口打开文件直链</a>` : ''}
                  </div>
                `;
                bodyEl.prepend(box);
                bodyEl.scrollTop = 0;
                box.querySelector('#stcap-retry-saf')?.addEventListener('click', () => {
                    try {
                        window.LukerAndroid.saveFileFromUrl(JSON.stringify({
                            url: saved.staged.fullUrl,
                            fileName,
                            mimeType,
                            method: 'GET',
                            headers: getCtx().getRequestHeaders ? getCtx().getRequestHeaders() : {},
                        }));
                    } catch (e) {
                        console.error(e);
                    }
                });
            };

            if (mode === 'png') {
                statusEl.textContent = `正在进行 GZIP 压缩并上传至本地暂存服务...`;
                const compressedChunkText = await compressCapsulePayload(jsonStr);
                const finalPngBytes = buildCapsulePng(pngBytes, v2Card, compressedChunkText);
                const fileName = `${safeBase}.capsule.png`;
                const saved = await saveGeneratedPayload({
                    bytes: finalPngBytes,
                    filename: fileName,
                    mimeType: 'image/png',
                    extSuffix: '.capsule.png',
                    useMobileShare,
                });
                const mb = (finalPngBytes.byteLength / 1024 / 1024).toFixed(2);
                renderManualSaveBox(saved, fileName, 'image/png', mb);
                statusEl.textContent = `✅ 打包完成：${fileName} (${mb} MB，见上方绿色保存卡片)`;
                if (window.toastr) window.toastr.success(`已生成 ${fileName} (${mb} MB)`);
            } else {
                statusEl.textContent = `正在打包并上传至本地暂存服务...`;
                const jsonBytes = new TextEncoder().encode(jsonStr);
                const fileName = `${safeBase}.stcapsule.json`;
                const saved = await saveGeneratedPayload({
                    bytes: jsonBytes,
                    filename: fileName,
                    mimeType: 'application/json',
                    extSuffix: '.json',
                    useMobileShare,
                });
                const mb = (jsonBytes.byteLength / 1024 / 1024).toFixed(2);
                renderManualSaveBox(saved, fileName, 'application/json', mb);
                statusEl.textContent = `✅ 打包完成：${fileName} (${mb} MB，见上方绿色保存卡片)`;
                if (window.toastr) window.toastr.success(`已生成 ${fileName} (${mb} MB)`);
            }
        } catch (err) {
            console.error('[ST-Capsule] Export error:', err);
            statusEl.textContent = `❌ 导出失败：${err?.message || err}`;
            if (window.toastr) window.toastr.error(String(err?.message || err));
        } finally {
            btnPng.disabled = false;
            btnJson.disabled = false;
            if (btnShare) btnShare.disabled = false;
        }
    }

    function renderImportTab() {
        bodyEl.innerHTML = `
          <div class="stcap-dropzone" id="stcap-dropzone">
            <div style="font-size:28px;margin-bottom:8px;">📥</div>
            <div style="font-size:14px;font-weight:700;color:#e2e8f0;">点击选择或拖入 <code>.capsule.png</code> / <code>.stcapsule.json</code> / 普通角色卡 <code>.png</code></div>
            <div style="font-size:12px;color:#94a3b8;margin-top:6px;">支持完整解析并按需勾选还原：角色卡本体、多本世界书及绑定关系、预设、全局/局部正则、全部历史聊天分支</div>
            <input type="file" id="stcap-file-input" accept=".png,.json,image/png,application/json" style="display:none" />
          </div>
          <div id="stcap-import-preview"></div>
        `;
        footerEl.innerHTML = `
          <div class="stcap-status" id="stcap-import-status">等待载入胶囊文件...</div>
          <div class="stcap-export-btns">
            <button type="button" class="stcap-action-btn" id="stcap-btn-restore" disabled>⚡ 一键还原勾选项到酒馆</button>
          </div>
        `;

        const dz = bodyEl.querySelector('#stcap-dropzone');
        const fi = bodyEl.querySelector('#stcap-file-input');
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', async (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
            if (e.dataTransfer?.files?.[0]) await handleImportFile(e.dataTransfer.files[0]);
        });
        fi.addEventListener('change', async () => {
            if (fi.files?.[0]) await handleImportFile(fi.files[0]);
        });
    }

    async function handleImportFile(file) {
        const previewEl = bodyEl.querySelector('#stcap-import-preview');
        const statusEl = footerEl.querySelector('#stcap-import-status');
        const restoreBtn = footerEl.querySelector('#stcap-btn-restore');
        try {
            statusEl.textContent = `正在解析 ${file.name}...`;
            const parsed = await parseAnyCapsuleOrCardFile(file);
            const cap = parsed.capsule;
            const books = cap.worldbooks?.books || [];
            const chats = cap.chats || [];
            const presets = cap.presets?.items || [];
            const gRegex = cap.regex?.global || [];
            const sRegex = cap.regex?.scoped || [];

            const thGlobal = cap.tavern_helper?.global_scripts || [];
            const existingChars = ctx.characters || [];
            const rawCharName = cap.character?.name || 'Character';
            const rawAvatarKey = String(cap.character?.avatar || '').replace(/\.png$/i, '');
            const collidingChar = existingChars.find(c =>
                (rawAvatarKey && String(c.avatar || '').replace(/\.png$/i, '') === rawAvatarKey) ||
                c.name === rawCharName
            );

            previewEl.innerHTML = `
              <div class="stcap-section" style="margin-top:8px;border-color:rgba(250,204,21,0.45);background:rgba(30,27,18,0.65);">
                <div class="stcap-section-title">🛡️ 同名文件冲突处理策略 ${collidingChar ? `<span class="stcap-badge warn">检测到酒馆已有同名角色：${escapeHtml(collidingChar.name)}</span>` : `<span class="stcap-badge">未检测到角色重名</span>`}</div>
                <label class="stcap-item">
                  <input type="radio" name="stcap-collision-mode" value="overwrite" checked />
                  <span class="stcap-item-label" style="white-space:normal;"><strong>🔄 原位覆盖升级（推荐更新设定时使用）</strong>：精准覆盖同名角色卡（不产生 <code>_1</code> 分身卡）、覆盖更新同名世界书与预设，并清理旧废案世界书绑定</span>
                </label>
                <label class="stcap-item">
                  <input type="radio" name="stcap-collision-mode" value="coexist" />
                  <span class="stcap-item-label" style="white-space:normal;"><strong>🆕 加后缀独立并存（不覆盖任何旧文件）</strong>：为角色卡、预设及世界书统一追加后缀并自动重定向绑定关系，与旧版完全隔离并存</span>
                </label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:2px 6px;">
                  <span style="font-size:12px;color:#cbd5e1;">并存模式后缀：</span>
                  <input type="text" class="stcap-search" id="stcap-coexist-suffix" value=" [AGY新版]" style="width:150px;" />
                  <label style="font-size:12px;color:#cbd5e1;display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
                    <input type="checkbox" id="stcap-skip-existing-chats" checked />
                    <span>原位升级时跳过本地已存在的同名聊天（防止覆盖手机新聊进度）</span>
                  </label>
                </div>
              </div>

              <div class="stcap-grid" style="margin-top:8px;">
                <div class="stcap-section">
                  <div class="stcap-section-title">👤 角色、正则与脚本</div>
                  <label class="stcap-item">
                    <input type="checkbox" id="stcap-res-char" checked />
                    <span class="stcap-item-label">导入角色卡：${escapeHtml(rawCharName)}</span>
                  </label>
                  <label class="stcap-item">
                    <input type="checkbox" id="stcap-res-gregex" ${gRegex.length ? 'checked' : 'disabled'} />
                    <span class="stcap-item-label">同步全局正则 (${gRegex.length} 条，按 ID/名称去重更新)</span>
                  </label>
                  <label class="stcap-item">
                    <input type="checkbox" id="stcap-res-th" ${thGlobal.length ? 'checked' : 'disabled'} />
                    <span class="stcap-item-label">同步全局酒馆助手脚本 (${thGlobal.length} 个，按名称去重)</span>
                  </label>
                  <div style="font-size:11px;color:#94a3b8;padding:2px 8px;">角色局部正则 ${sRegex.length} 条随角色卡自动携带。</div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">🌍 包含的世界书 (${books.length} 本)</span>
                    <div class="stcap-mini-actions">
                      <button type="button" class="stcap-mini-btn" id="stcap-res-wb-all">全选</button>
                      <button type="button" class="stcap-mini-btn" id="stcap-res-wb-none">清空</button>
                    </div>
                  </div>
                  <div class="stcap-list">
                    ${books.length ? books.map((b, i) => `
                      <label class="stcap-item">
                        <input type="checkbox" class="stcap-res-wb" value="${i}" checked />
                        <span class="stcap-item-label" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
                        <span class="stcap-item-sub">${Object.keys(b.data?.entries || {}).length} 条</span>
                      </label>
                    `).join('') : '<div style="color:#64748b;font-size:12px;padding:6px;">无附加世界书</div>'}
                  </div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-title">🎛️ 包含的预设 (${presets.length} 套)</div>
                  <div class="stcap-list">
                    ${presets.length ? presets.map((p, i) => `
                      <label class="stcap-item">
                        <input type="checkbox" class="stcap-res-preset" value="${i}" checked />
                        <span class="stcap-item-label">${escapeHtml(p.name)}</span>
                      </label>
                    `).join('') : '<div style="color:#64748b;font-size:12px;padding:6px;">无预设数据</div>'}
                  </div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-head">
                    <span class="stcap-section-title">💬 包含的聊天记录 (${chats.length} 段)</span>
                    <div class="stcap-mini-actions">
                      <button type="button" class="stcap-mini-btn" id="stcap-res-chat-all">全选</button>
                      <button type="button" class="stcap-mini-btn" id="stcap-res-chat-none">清空</button>
                    </div>
                  </div>
                  <div class="stcap-list">
                    ${chats.length ? chats.map((c, i) => `
                      <label class="stcap-item">
                        <input type="checkbox" class="stcap-res-chat" value="${i}" checked />
                        <span class="stcap-item-label" title="${escapeHtml(c.file_id)}">${escapeHtml(c.file_id)}</span>
                        <span class="stcap-item-sub">${c.message_count ?? (c.messages?.length || 0)} 条</span>
                      </label>
                    `).join('') : '<div style="color:#64748b;font-size:12px;padding:6px;">无聊天记录</div>'}
                  </div>
                </div>
              </div>
            `;
            previewEl.querySelector('#stcap-res-wb-all')?.addEventListener('click', () => {
                previewEl.querySelectorAll('.stcap-res-wb').forEach(c => { c.checked = true; });
            });
            previewEl.querySelector('#stcap-res-wb-none')?.addEventListener('click', () => {
                previewEl.querySelectorAll('.stcap-res-wb').forEach(c => { c.checked = false; });
            });
            previewEl.querySelector('#stcap-res-chat-all')?.addEventListener('click', () => {
                previewEl.querySelectorAll('.stcap-res-chat').forEach(c => { c.checked = true; });
            });
            previewEl.querySelector('#stcap-res-chat-none')?.addEventListener('click', () => {
                previewEl.querySelectorAll('.stcap-res-chat').forEach(c => { c.checked = false; });
            });

            statusEl.textContent = `解析成功：${rawCharName}（含 ${books.length} 本世界书、${presets.length} 套预设、${chats.length} 段聊天）`;
            restoreBtn.disabled = false;
            restoreBtn.onclick = () => executeRestore(cap);
        } catch (err) {
            console.error('[ST-Capsule] Import parse error:', err);
            previewEl.innerHTML = '';
            statusEl.textContent = `❌ 解析失败：${err?.message || err}`;
            restoreBtn.disabled = true;
        }
    }

    async function executeRestore(cap) {
        const statusEl = footerEl.querySelector('#stcap-import-status');
        const restoreBtn = footerEl.querySelector('#stcap-btn-restore');
        restoreBtn.disabled = true;
        try {
            const { extMod, pmMod, wiMod } = await getHostMods();
            const extension_settings = extMod.extension_settings || ctx.extensionSettings || {};
            const world_info = wiMod.world_info || {};
            const getPresetManager = pmMod.getPresetManager || ctx.getPresetManager;

            const collisionMode = bodyEl.querySelector('input[name="stcap-collision-mode"]:checked')?.value || 'overwrite';
            const rawSuffix = bodyEl.querySelector('#stcap-coexist-suffix')?.value || ' [AGY新版]';
            const suffix = collisionMode === 'coexist' ? rawSuffix : '';
            const skipExistingChats = collisionMode === 'overwrite' && Boolean(bodyEl.querySelector('#stcap-skip-existing-chats')?.checked);

            // Map old worldbook names -> target worldbook names (handles coexist suffix coherently across bindings!)
            const wbNameMap = new Map();
            const wbIndices = [...bodyEl.querySelectorAll('.stcap-res-wb:checked')].map(c => Number(c.value));
            for (let i = 0; i < wbIndices.length; i++) {
                const idx = wbIndices[i];
                const wb = cap.worldbooks.books[idx];
                if (!wb?.name || !wb?.data) continue;
                const finalWbName = suffix ? `${wb.name}${suffix}` : wb.name;
                wbNameMap.set(wb.name, finalWbName);
                statusEl.textContent = `正在写入世界书 (${i + 1}/${wbIndices.length})：${finalWbName}...`;
                const wbPayload = safeJsonClone(wb.data, wb.data);
                wbPayload.name = finalWbName;
                await apiPost('/api/worldinfo/edit', { name: finalWbName, data: wbPayload });
            }

            const origCharName = cap.character?.name || 'Character';
            const finalCharName = suffix ? `${origCharName}${suffix}` : origCharName;
            let targetAvatar = `${sanitizeDownloadName(finalCharName)}.png`;

            // Detect existing character in SillyTavern for in-place overwrite (prevents _1 twin duplicate cards!)
            const existingChars = ctx.characters || [];
            const origAvatarKey = String(cap.character?.avatar || '').replace(/\.png$/i, '');
            const matchedExistingChar = collisionMode === 'overwrite'
                ? existingChars.find(c =>
                    (origAvatarKey && String(c.avatar || '').replace(/\.png$/i, '') === origAvatarKey) ||
                    c.name === origCharName
                  )
                : null;

            const activeChatObj = (cap.chats || []).find(c => c.is_active_chat) || cap.chats?.[(cap.chats?.length || 1) - 1];
            const activeChatId = activeChatObj?.file_id || cap.character?.card?.chat || '';

            if (bodyEl.querySelector('#stcap-res-char')?.checked && cap.character?.card) {
                statusEl.textContent = `正在导入角色卡：${finalCharName}...`;
                let pngBytes = cap._raw_png_bytes;
                if (!pngBytes && cap.character.avatar_png_base64) {
                    pngBytes = base64ToUint8(cap.character.avatar_png_base64);
                }
                if (!pngBytes) {
                    pngBytes = await createFallbackPngBytes(finalCharName);
                }
                const cardCopy = safeJsonClone(cap.character.card, {});
                cardCopy.name = finalCharName;
                if (cardCopy.data) {
                    cardCopy.data.name = finalCharName;
                    if (cardCopy.data.extensions?.world && wbNameMap.has(cardCopy.data.extensions.world)) {
                        cardCopy.data.extensions.world = wbNameMap.get(cardCopy.data.extensions.world);
                    }
                }
                if (activeChatId) cardCopy.chat = activeChatId;

                const cleanChunks = extractPngChunks(pngBytes).filter(ch => {
                    if (ch.name !== 'tEXt') return true;
                    const dec = decodeTextChunk(ch.data);
                    return !dec || !['chara', 'ccv3', 'st_capsule'].includes(dec.keyword.toLowerCase());
                });
                const v2Str = JSON.stringify(cardCopy);
                const iend = cleanChunks.findIndex(c => c.name === 'IEND');
                cleanChunks.splice(iend >= 0 ? iend : cleanChunks.length, 0, makeTextChunk('chara', utf8ToBase64(v2Str)));
                const cleanPng = encodePngChunks(cleanChunks);

                const fd = new FormData();
                fd.append('avatar', new Blob([cleanPng], { type: 'image/png' }), targetAvatar);
                fd.append('file_type', 'png');
                if (matchedExistingChar?.avatar) {
                    const preservedKey = String(matchedExistingChar.avatar).replace(/\.png$/i, '');
                    fd.append('preserved_name', preservedKey);
                    targetAvatar = matchedExistingChar.avatar;
                }
                if (matchedExistingChar?.chat && skipExistingChats) {
                    fd.append('preserved_chat', matchedExistingChar.chat);
                } else if (activeChatId) {
                    fd.append('preserved_chat', activeChatId);
                }

                const headers = ctx.getRequestHeaders ? { ...ctx.getRequestHeaders() } : {};
                delete headers['Content-Type'];
                const impResp = await fetch('/api/characters/import', { method: 'POST', headers, body: fd });
                if (impResp.ok) {
                    const impJson = await impResp.json();
                    if (impJson?.file_name) targetAvatar = `${impJson.file_name}.png`;
                }
            } else if (matchedExistingChar?.avatar) {
                targetAvatar = matchedExistingChar.avatar;
            }

            const rawExtraBooks = cap.worldbooks?.bindings?.extra || [];
            const mappedExtraBooks = rawExtraBooks.map(b => wbNameMap.get(b) || (suffix ? `${b}${suffix}` : b));
            if (mappedExtraBooks.length > 0) {
                const charKey = targetAvatar.replace(/\.png$/i, '');
                if (typeof wiMod.charSetAuxWorlds === 'function') {
                    try { wiMod.charSetAuxWorlds(targetAvatar, mappedExtraBooks); } catch {}
                }
                if (world_info) {
                    world_info.charLore = world_info.charLore || [];
                    const existing = world_info.charLore.find(e => e.name === charKey || e.name === targetAvatar);
                    if (existing) {
                        // Replace cleanly instead of merging stale renamed books (e.g. 深海族 -> 深海猎人)
                        existing.extraBooks = [...new Set(mappedExtraBooks)];
                    } else {
                        world_info.charLore.push({ name: charKey, extraBooks: [...new Set(mappedExtraBooks)] });
                    }
                    ctx.saveSettingsDebounced?.();
                }
            }

            const presetIndices = [...bodyEl.querySelectorAll('.stcap-res-preset:checked')].map(c => Number(c.value));
            const pm = typeof getPresetManager === 'function' ? getPresetManager() : null;
            for (const idx of presetIndices) {
                const p = cap.presets.items[idx];
                if (p?.name && p?.data && pm?.savePreset) {
                    const finalPresetName = suffix ? `${p.name}${suffix}` : p.name;
                    statusEl.textContent = `正在写入预设：${finalPresetName}...`;
                    const pCopy = safeJsonClone(p.data, p.data);
                    pCopy.name = finalPresetName;
                    await pm.savePreset(finalPresetName, pCopy);
                }
            }

            if (bodyEl.querySelector('#stcap-res-gregex')?.checked && Array.isArray(cap.regex?.global)) {
                extension_settings.regex = extension_settings.regex || [];
                for (const rx of cap.regex.global) {
                    if (!rx) continue;
                    const existIdx = extension_settings.regex.findIndex(r =>
                        (rx.id && r.id === rx.id) ||
                        (rx.scriptName && r.scriptName === rx.scriptName && r.findRegex === rx.findRegex)
                    );
                    if (existIdx >= 0) {
                        extension_settings.regex[existIdx] = safeJsonClone(rx, rx);
                    } else {
                        extension_settings.regex.push(safeJsonClone(rx, rx));
                    }
                }
                ctx.saveSettingsDebounced?.();
            }

            if (bodyEl.querySelector('#stcap-res-th')?.checked && Array.isArray(cap.tavern_helper?.global_scripts) && cap.tavern_helper.global_scripts.length > 0) {
                extension_settings.tavern_helper = extension_settings.tavern_helper || {};
                extension_settings.tavern_helper.script = extension_settings.tavern_helper.script || { enabled: { global: true }, scripts: [] };
                const curList = Array.isArray(extension_settings.tavern_helper.script.scripts)
                    ? extension_settings.tavern_helper.script.scripts
                    : Object.values(extension_settings.tavern_helper.script.scripts || {});
                for (const sc of cap.tavern_helper.global_scripts) {
                    if (!sc) continue;
                    const sKey = sc.id || sc.name;
                    const eIdx = curList.findIndex(x => (sc.id && x.id === sc.id) || (sc.name && x.name === sc.name));
                    if (eIdx >= 0) curList[eIdx] = safeJsonClone(sc, sc);
                    else if (sKey) curList.push(safeJsonClone(sc, sc));
                }
                extension_settings.tavern_helper.script.scripts = curList;
                ctx.saveSettingsDebounced?.();
            }

            const chatIndices = [...bodyEl.querySelectorAll('.stcap-res-chat:checked')].map(c => Number(c.value));
            let existingChatIds = new Set();
            if (skipExistingChats && chatIndices.length > 0) {
                try {
                    const existResp = await apiPost('/api/characters/chats', { avatar_url: targetAvatar, simple: true });
                    if (Array.isArray(existResp)) {
                        existingChatIds = new Set(existResp.map(c => c.file_id || String(c.file_name || '').replace(/\.jsonl$/i, '')));
                    }
                } catch {}
            }

            let writtenChats = 0;
            let skippedChats = 0;
            for (let i = 0; i < chatIndices.length; i++) {
                const idx = chatIndices[i];
                const ch = cap.chats[idx];
                if (!ch?.file_id || !Array.isArray(ch.messages)) continue;
                if (skipExistingChats && existingChatIds.has(ch.file_id)) {
                    skippedChats++;
                    continue;
                }
                statusEl.textContent = `正在恢复聊天分支 (${i + 1}/${chatIndices.length})：${ch.file_id}...`;
                await apiPost('/api/chats/save', {
                    ch_name: finalCharName,
                    file_name: ch.file_id,
                    chat: ch.messages,
                    avatar_url: targetAvatar,
                    force: true,
                });
                writtenChats++;
            }

            if (typeof ctx.getCharacters === 'function') await ctx.getCharacters();
            statusEl.textContent = `✅ 还原完成（${collisionMode === 'coexist' ? `独立并存后缀 "${suffix}"` : '原位覆盖升级'}）：已写入 ${wbIndices.length} 本世界书、${presetIndices.length} 套预设、${writtenChats} 段聊天${skippedChats ? `（已保护跳过 ${skippedChats} 段本地已有聊天）` : ''}。`;
            if (window.toastr) window.toastr.success('全量胶囊还原成功');
        } catch (err) {
            console.error('[ST-Capsule] Restore error:', err);
            statusEl.textContent = `❌ 还原出错：${err?.message || err}`;
            if (window.toastr) window.toastr.error(String(err?.message || err));
        } finally {
            restoreBtn.disabled = false;
        }
    }

    if (activeTab === 'export') await renderExportTab();
    else renderImportTab();
}

// ============================================================================
// Resilient Mounting & Document-Level Event Delegation (Luker & ST Safe)
// ============================================================================
function mountExtensionUi() {
    ensureCriticalStyles();

    const drawerTarget = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (drawerTarget && !document.getElementById('st_capsule_packer_container')) {
        const wrap = document.createElement('div');
        wrap.className = 'extension_container';
        wrap.id = 'st_capsule_packer_container';
        wrap.innerHTML = `
          <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>📦 酒馆全量胶囊打包器 (ST Capsule Packer)</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content stcap-drawer-box">
              <div style="color:#94a3b8;line-height:1.5;">
                将角色卡、当前预设、全局/局部正则、酒馆助手脚本、绑定的多本世界书与所有历史聊天记录一键压入单张 <code>.capsule.png</code> 角色卡或独立 <code>.stcapsule.json</code> 备份文件。
              </div>
              <div class="stcap-btn-row">
                <button type="button" class="stcap-trigger-btn primary" id="stcap-open-export">📤 打包导出当前角色</button>
                <button type="button" class="stcap-trigger-btn" id="stcap-open-import">📥 读取 / 还原胶囊</button>
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
          <span>全量角色胶囊打包 / 还原</span>
        `;
        wandMenu.appendChild(wandItem);
    }

    const exportBtn = document.getElementById('export_button');
    if (exportBtn && !document.getElementById('stcap-char-btn')) {
        const charBtn = document.createElement('div');
        charBtn.id = 'stcap-char-btn';
        charBtn.className = 'menu_button fa-solid fa-box-archive interactable';
        charBtn.title = '打包全量角色胶囊 (含预设/正则/多世界书/全部聊天)';
        charBtn.tabIndex = 0;
        exportBtn.insertAdjacentElement('afterend', charBtn);
    }
}

// Global delegated click listener (survives DOM clones, drawer moves, and prevents drawer auto-close)
if (!window.__stCapsuleDelegatedBound) {
    window.__stCapsuleDelegatedBound = true;
    document.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const exportTrigger = target.closest('#stcap-open-export, #stcap-char-btn');
        if (exportTrigger) {
            e.preventDefault();
            e.stopPropagation();
            openCapsuleModal('export');
            return;
        }

        const importTrigger = target.closest('#stcap-open-import');
        if (importTrigger) {
            e.preventDefault();
            e.stopPropagation();
            openCapsuleModal('import');
            return;
        }

        const wandTrigger = target.closest('#stcap-wand-item');
        if (wandTrigger) {
            e.preventDefault();
            e.stopPropagation();
            const wm = document.getElementById('extensionsMenu');
            if (wm) wm.style.display = 'none';
            openCapsuleModal('export');
        }
    }, true);
}

function initExtension() {
    mountExtensionUi();
    // Re-check mount after delayed UI hydration in Luker
    setTimeout(mountExtensionUi, 1200);

    const ctx = getCtx();
    if (ctx.SlashCommandParser && ctx.SlashCommand) {
        try {
            ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                name: 'capsule',
                callback: (_args, val) => {
                    const mode = String(val || '').trim().toLowerCase() === 'import' ? 'import' : 'export';
                    openCapsuleModal(mode);
                    return '';
                },
                helpString: '打开酒馆全量胶囊打包/还原工作台（用法：/capsule 或 /capsule import）',
            }));
        } catch {}
    }
    console.log(`[${EXT_ID}] v1.2.0 initialized (LukerAndroid=${isLukerAndroidApp()}).`);
}

if (typeof jQuery !== 'undefined') {
    jQuery(() => initExtension());
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtension);
} else {
    initExtension();
}
