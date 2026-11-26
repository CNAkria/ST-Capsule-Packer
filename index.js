// ST Capsule Packer — Full Character + Preset + Regex + Multi-Worldbook + All Chats Exporter & Restorer
import { extension_settings } from '../../../extensions.js';
import { getPresetManager } from '../../../preset-manager.js';
import { power_user } from '../../../power-user.js';
import { world_info } from '../../../world-info.js';

const EXT_ID = 'ST-Capsule-Packer';

// ============================================================================
// Pure Browser PNG Chunk & GZIP Codec (Zero External Dependencies)
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
                version: '1.0.0',
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
                version: '1.0.0',
                character: { name: parsed?.data?.name || parsed?.name || 'Character', card: parsed },
                presets: { items: [] },
                regex: { global: [], scoped: parsed?.data?.extensions?.regex_scripts || [], preset: [] },
                tavern_helper: { global_scripts: [], character_scripts: [] },
                worldbooks: { bindings: {}, books: [] },
                chats: [],
            },
        };
    }
    throw new Error('无法识别的文件格式，请拖入 .capsule.png、普通角色卡 .png 或 .stcapsule.json。');
}

// ============================================================================
// SillyTavern Data Collectors & Restorers
// ============================================================================
function getCtx() {
    return window.SillyTavern?.getContext?.() || {};
}

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
    g.fillText(label.slice(0, 12), 256, 384);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

async function fetchCharacterAvatarBytes(avatar) {
    try {
        const resp = await fetch(`/characters/${encodeURIComponent(avatar)}`, { cache: 'no-store' });
        if (resp.ok) {
            const buf = new Uint8Array(await resp.arrayBuffer());
            if (buf.length > 8 && buf[0] === 137 && buf[1] === 80) return buf;
        }
    } catch (e) {
        console.warn('[ST-Capsule] Avatar fetch fallback:', e);
    }
    return await createFallbackPngBytes(avatar);
}

function buildStandardV2Card(charObj) {
    const data = structuredClone(charObj.data || {});
    data.name = data.name || charObj.name || '';
    data.description = data.description ?? charObj.description ?? '';
    data.personality = data.personality ?? charObj.personality ?? '';
    data.scenario = data.scenario ?? charObj.scenario ?? '';
    data.first_mes = data.first_mes ?? charObj.first_mes ?? '';
    data.mes_example = data.mes_example ?? charObj.mes_example ?? '';
    data.creator_notes = data.creator_notes ?? charObj.creatorcomment ?? '';
    data.tags = Array.isArray(data.tags) ? data.tags : (Array.isArray(charObj.tags) ? charObj.tags : []);
    data.alternate_greetings = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [];
    data.extensions = data.extensions || {};
    if (charObj.fav !== undefined) data.extensions.fav = Boolean(charObj.fav);
    if (charObj.talkativeness !== undefined) data.extensions.talkativeness = charObj.talkativeness;

    return {
        name: data.name,
        description: data.description,
        personality: data.personality,
        scenario: data.scenario,
        first_mes: data.first_mes,
        mes_example: data.mes_example,
        creatorcomment: data.creator_notes || '',
        avatar: 'none',
        chat: charObj.chat || '',
        talkativeness: String(charObj.talkativeness ?? '0.5'),
        fav: Boolean(charObj.fav),
        tags: data.tags,
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data,
    };
}

async function inspectCharacterWorkspace(chid) {
    const ctx = getCtx();
    const characters = ctx.characters || [];
    if (chid === undefined || chid === null || !characters[chid]) {
        return null;
    }
    if (typeof ctx.unshallowCharacter === 'function') {
        try { await ctx.unshallowCharacter(chid); } catch (e) { console.warn('[ST-Capsule] unshallow warning:', e); }
    }
    const charObj = characters[chid];
    const avatar = charObj.avatar;
    const charKey = String(avatar || '').replace(/\.png$/i, '');

    // 1. Worldbooks discovery
    let allWorldList = [];
    try {
        const wiResp = await apiPost('/api/worldinfo/list', {});
        allWorldList = Array.isArray(wiResp) ? wiResp.map(w => w.file_id || w.name).filter(Boolean) : [];
    } catch (e) {
        console.warn('[ST-Capsule] worldinfo/list error:', e);
    }

    const roleMap = new Map();
    const addBookRole = (bookName, role) => {
        if (!bookName || typeof bookName !== 'string') return;
        if (!roleMap.has(bookName)) roleMap.set(bookName, new Set());
        roleMap.get(bookName).add(role);
    };

    const primaryBook = charObj?.data?.extensions?.world || charObj?.world || null;
    if (primaryBook) addBookRole(primaryBook, '角色主世界书');

    const charLoreArr = world_info?.charLore || [];
    const extraEntry = charLoreArr.find(e => e.name === charKey || e.name === avatar);
    if (Array.isArray(extraEntry?.extraBooks)) {
        extraEntry.extraBooks.forEach(b => addBookRole(b, '角色附加世界书'));
    }

    const globalBooks = world_info?.globalSelect || [];
    if (Array.isArray(globalBooks)) {
        globalBooks.forEach(b => addBookRole(b, '全局启用世界书'));
    }

    // WorldInfoLocks plugin support
    const wiLocks = extension_settings?.worldInfoPresets;
    const lockedPresetName = wiLocks?.characterLocks?.[avatar] || wiLocks?.characterLocks?.[charKey];
    if (lockedPresetName && Array.isArray(wiLocks?.presetList)) {
        const foundPreset = wiLocks.presetList.find(p => p.name === lockedPresetName);
        if (Array.isArray(foundPreset?.worldList)) {
            foundPreset.worldList.forEach(b => addBookRole(b, 'WorldInfoLocks绑定'));
        }
    }

    // Persona lorebook
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
                    mes_preview: (c.mes || '').slice(0, 80),
                    is_active: fileId === charObj.chat,
                };
            });
        }
    } catch (e) {
        console.warn('[ST-Capsule] characters/chats error:', e);
    }

    // Also check active chat metadata worldbook
    if (ctx.characterId == chid && ctx.chatMetadata?.world_info) {
        addBookRole(ctx.chatMetadata.world_info, '当前聊天绑定');
    }

    // Merge bound books + all other available books
    const worldbookOptions = [];
    for (const [name, roles] of roleMap.entries()) {
        worldbookOptions.push({ name, roles: [...roles], preselected: true });
    }
    for (const name of allWorldList) {
        if (!roleMap.has(name)) {
            worldbookOptions.push({ name, roles: [], preselected: false });
        }
    }

    // 3. Presets discovery
    const pm = getPresetManager?.();
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
    if (activePresetName && !presetNames.includes(activePresetName)) {
        presetNames.unshift(activePresetName);
    }

    // 4. Regex & TavernHelper discovery
    const globalRegex = Array.isArray(extension_settings?.regex) ? extension_settings.regex : [];
    const scopedRegex = Array.isArray(charObj?.data?.extensions?.regex_scripts) ? charObj.data.extensions.regex_scripts : [];
    let presetRegex = [];
    try {
        const activePresetData = pm?.getPresetSettings?.(activePresetName);
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
        name: charObj.name,
        worldbookOptions,
        chatFiles,
        activePresetName,
        presetNames,
        globalRegex,
        scopedRegex,
        presetRegex,
        thGlobalScripts: Array.isArray(thGlobalScripts) ? thGlobalScripts : Object.values(thGlobalScripts),
        thCharScripts: Array.isArray(thCharScripts) ? thCharScripts : Object.values(thCharScripts),
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

function canShareFileMobile() {
    try {
        if (typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined') {
            const testFile = new File(['1'], 't.png', { type: 'image/png' });
            return navigator.canShare({ files: [testFile] });
        }
    } catch {}
    return false;
}

async function triggerBlobDownload(blob, filename, useMobileShare = false) {
    if (useMobileShare && navigator.share && typeof File !== 'undefined') {
        try {
            const fileObj = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
            if (!navigator.canShare || navigator.canShare({ files: [fileObj] })) {
                await navigator.share({
                    title: filename,
                    files: [fileObj],
                });
                return;
            }
        } catch (err) {
            if (err?.name === 'AbortError') return;
            console.warn('[ST-Capsule] Share fallback to download:', err);
        }
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
    }, 2500);
}

// ============================================================================
// Interactive Modal UI (Export & Restore)
// ============================================================================
async function openCapsuleModal(initialTab = 'export') {
    document.querySelectorAll('.stcap-overlay').forEach(el => el.remove());

    const ctx = getCtx();
    const characters = ctx.characters || [];
    let currentChid = ctx.characterId !== undefined && ctx.characterId !== null && characters[ctx.characterId]
        ? Number(ctx.characterId)
        : (characters.length > 0 ? 0 : -1);

    const overlay = document.createElement('div');
    overlay.className = 'stcap-overlay';
    overlay.innerHTML = `
      <div class="stcap-modal">
        <div class="stcap-hazard-bar"></div>
        <div class="stcap-header">
          <div class="stcap-title-wrap">
            <span class="stcap-title">📦 酒馆全量胶囊工作台 (ST Capsule Studio)</span>
            <span class="stcap-neon-tag">ST-CAPSULE v1.0</span>
          </div>
          <button class="stcap-close" title="关闭">✕</button>
        </div>
        <div class="stcap-tabs">
          <button class="stcap-tab ${initialTab === 'export' ? 'active' : ''}" data-tab="export">📤 绑定打包导出</button>
          <button class="stcap-tab ${initialTab === 'import' ? 'active' : ''}" data-tab="import">📥 读取 / 还原胶囊</button>
        </div>
        <div class="stcap-body" id="stcap-body"></div>
        <div class="stcap-footer" id="stcap-footer"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.stcap-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    let activeTab = initialTab;
    let inspected = null;
    let loadedImport = null;

    const bodyEl = overlay.querySelector('#stcap-body');
    const footerEl = overlay.querySelector('#stcap-footer');

    overlay.querySelectorAll('.stcap-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
            activeTab = btn.dataset.tab;
            overlay.querySelectorAll('.stcap-tab').forEach(b => b.classList.toggle('active', b === btn));
            if (activeTab === 'export') await renderExportTab();
            else renderImportTab();
        });
    });

    async function renderExportTab() {
        if (characters.length === 0 || currentChid < 0) {
            bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#94a3b8;">当前酒馆中暂无可导出的角色卡。</div>`;
            footerEl.innerHTML = '';
            return;
        }
        bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#8ab4f8;">正在扫描角色绑定的预设、正则、多世界书与全部聊天分支...</div>`;
        footerEl.innerHTML = '';

        inspected = await inspectCharacterWorkspace(currentChid);
        if (!inspected) return;

        const charOptionsHtml = characters.map((c, idx) =>
            `<option value="${idx}" ${idx === currentChid ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.avatar)})</option>`
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
            : `<div style="color:#64748b;font-size:12px;padding:8px;">该角色暂无历史聊天记录 (.jsonl)</div>`;

        bodyEl.innerHTML = `
          <div class="stcap-char-bar">
            <img class="stcap-avatar-preview" src="/characters/${encodeURIComponent(inspected.avatar)}" onerror="this.style.display='none'" />
            <div style="flex:1;min-width:220px;">
              <div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">选择要打包的角色卡（已自动勾选其绑定的世界书、激活预设、正则与全部聊天记录）</div>
              <select class="stcap-select" id="stcap-char-select">${charOptionsHtml}</select>
            </div>
          </div>

          <div class="stcap-grid">
            <div class="stcap-section">
              <div class="stcap-section-head">
                <span class="stcap-section-title">🌍 多本世界书 <span class="stcap-badge">${inspected.worldbookOptions.filter(w => w.preselected).length} 已绑定 / 共 ${inspected.worldbookOptions.length}</span></span>
                <div class="stcap-mini-actions">
                  <button class="stcap-mini-btn" id="stcap-wb-bound">仅绑定</button>
                  <button class="stcap-mini-btn" id="stcap-wb-all">全选</button>
                  <button class="stcap-mini-btn" id="stcap-wb-none">清空</button>
                </div>
              </div>
              <input type="text" class="stcap-search" id="stcap-wb-search" placeholder="搜索世界书名称（可勾选任意多本一起打包）..." />
              <div class="stcap-list" id="stcap-wb-list">${wbItemsHtml}</div>
            </div>

            <div class="stcap-section">
              <div class="stcap-section-head">
                <span class="stcap-section-title">💬 所有聊天记录 <span class="stcap-badge">${inspected.chatFiles.length} 个分支</span></span>
                <div class="stcap-mini-actions">
                  <button class="stcap-mini-btn" id="stcap-chat-all">全选</button>
                  <button class="stcap-mini-btn" id="stcap-chat-none">清空</button>
                </div>
              </div>
              <div class="stcap-list">${chatItemsHtml}</div>
            </div>

            <div class="stcap-section">
              <div class="stcap-section-head">
                <span class="stcap-section-title">🎛️ 预设 (Presets) <span class="stcap-badge">${escapeHtml(ctx.mainApi || 'Chat')}</span></span>
              </div>
              <div class="stcap-list">${presetItemsHtml || '<div style="color:#64748b;font-size:12px;padding:6px;">未检测到预设列表，将直接抓取当前运行参数</div>'}</div>
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
                  <span class="stcap-item-label">当前用户名与人设描述 ({{user}} Persona)</span>
                  <span class="stcap-item-sub">${escapeHtml(ctx.name1 || '')}</span>
                </label>
              </div>
            </div>
          </div>
        `;

        const showMobileShare = canShareFileMobile();
        footerEl.innerHTML = `
          <div class="stcap-status" id="stcap-status">就绪：单卡 PNG 模式会将所有数据 GZIP 高压缩写入 PNG 的 <code>st_capsule</code> 块，同时完整保留标准 V2/V3 角色卡。</div>
          <div class="stcap-export-btns">
            <button class="stcap-action-btn secondary" id="stcap-btn-json">📄 导出独立文件 (.stcapsule.json)</button>
            <button class="stcap-action-btn" id="stcap-btn-png">🖼️ 绑定在一张卡里导出 (.capsule.png)</button>
            ${showMobileShare ? `<button class="stcap-action-btn" id="stcap-btn-share" style="background:linear-gradient(135deg,#059669,#0284c7);">📲 手机端直接转发 (.capsule.png)</button>` : ''}
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
            const selectedWbs = [...bodyEl.querySelectorAll('.stcap-wb-chk:checked')].map(c => c.value);
            const selectedChats = [...bodyEl.querySelectorAll('.stcap-chat-chk:checked')].map(c => c.value);
            const selectedPresets = [...bodyEl.querySelectorAll('.stcap-preset-chk:checked')].map(c => c.value);

            const incGlobalRegex = bodyEl.querySelector('#stcap-inc-global-regex')?.checked;
            const incScopedRegex = bodyEl.querySelector('#stcap-inc-scoped-regex')?.checked;
            const incPresetRegex = bodyEl.querySelector('#stcap-inc-preset-regex')?.checked;
            const incThScripts = bodyEl.querySelector('#stcap-inc-th-scripts')?.checked;
            const incPersona = bodyEl.querySelector('#stcap-inc-persona')?.checked;

            statusEl.textContent = `正在读取头像与角色卡基础结构...`;
            const pngBytes = await fetchCharacterAvatarBytes(inspected.avatar);
            const v2Card = buildStandardV2Card(inspected.charObj);

            // Fetch selected worldbooks
            const booksOut = [];
            for (let i = 0; i < selectedWbs.length; i++) {
                const wbName = selectedWbs[i];
                statusEl.textContent = `正在打包世界书 (${i + 1}/${selectedWbs.length}): ${wbName}...`;
                try {
                    const wbData = await apiPost('/api/worldinfo/get', { name: wbName });
                    const opt = inspected.worldbookOptions.find(o => o.name === wbName);
                    booksOut.push({
                        name: wbName,
                        roles: opt?.roles || [],
                        entry_count: Object.keys(wbData?.entries || {}).length,
                        data: wbData,
                    });
                } catch (err) {
                    console.warn('[ST-Capsule] Failed reading worldbook:', wbName, err);
                }
            }

            // Also attach primary worldbook into v2Card.data.character_book if present so standard card readers see it
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

            // Fetch presets
            statusEl.textContent = `正在提取预设配置 (${selectedPresets.length} 个)...`;
            const pm = getPresetManager?.();
            const presetItems = [];
            for (const pName of selectedPresets) {
                try {
                    const pData = pm?.getPresetSettings?.(pName);
                    if (pData) {
                        presetItems.push({
                            name: pName,
                            is_active: pName === inspected.activePresetName,
                            data: structuredClone(pData),
                        });
                    }
                } catch (e) {
                    console.warn('[ST-Capsule] Preset fetch warning:', pName, e);
                }
            }

            // Fetch all selected chat histories (.jsonl arrays)
            const chatsOut = [];
            for (let i = 0; i < selectedChats.length; i++) {
                const chatId = selectedChats[i];
                statusEl.textContent = `正在提取聊天记录 (${i + 1}/${selectedChats.length}): ${chatId}...`;
                try {
                    const messages = await apiPost('/api/chats/get', {
                        ch_name: inspected.name,
                        file_name: chatId,
                        avatar_url: inspected.avatar,
                    });
                    if (Array.isArray(messages)) {
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

            // Persona snapshot
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

            const capsuleObj = {
                spec: 'st_capsule_v1',
                version: '1.0.0',
                exported_at: new Date().toISOString(),
                source: 'SillyTavern-ST-Capsule-Packer',
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
                    power_user_context: {
                        instruct: power_user?.instruct || null,
                        context: power_user?.context || null,
                        sysprompt: power_user?.sysprompt || null,
                        reasoning: power_user?.reasoning || null,
                    },
                },
                regex: {
                    global: incGlobalRegex ? structuredClone(inspected.globalRegex) : [],
                    scoped: incScopedRegex ? structuredClone(inspected.scopedRegex) : [],
                    preset: incPresetRegex ? structuredClone(inspected.presetRegex) : [],
                },
                tavern_helper: {
                    global_scripts: incThScripts ? structuredClone(inspected.thGlobalScripts) : [],
                    character_scripts: incThScripts ? structuredClone(inspected.thCharScripts) : [],
                },
                worldbooks: {
                    bindings: {
                        primary: v2Card.data?.extensions?.world || null,
                        extra: (world_info?.charLore?.find(e => e.name === inspected.charKey || e.name === inspected.avatar)?.extraBooks) || [],
                        global: world_info?.globalSelect || [],
                    },
                    books: booksOut,
                },
                chats: chatsOut,
            };

            const safeBase = sanitizeDownloadName(inspected.name);
            const jsonStr = JSON.stringify(capsuleObj, null, mode === 'json' ? 2 : 0);

            if (mode === 'png') {
                statusEl.textContent = `正在进行 GZIP 压缩并写入角色卡 PNG 数据块...`;
                const compressedChunkText = await compressCapsulePayload(jsonStr);
                const finalPngBytes = buildCapsulePng(pngBytes, v2Card, compressedChunkText);
                const blob = new Blob([finalPngBytes], { type: 'image/png' });
                await triggerBlobDownload(blob, `${safeBase}.capsule.png`, useMobileShare);
                const mb = (finalPngBytes.byteLength / 1024 / 1024).toFixed(2);
                statusEl.textContent = `✅ 已导出单卡合一 PNG：${safeBase}.capsule.png (${mb} MB，含 ${booksOut.length} 本世界书、${chatsOut.length} 段聊天、${presetItems.length} 套预设)`;
                if (window.toastr) window.toastr.success(`已导出 ${safeBase}.capsule.png (${mb} MB)`);
            } else {
                const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
                await triggerBlobDownload(blob, `${safeBase}.stcapsule.json`, useMobileShare);
                const mb = (blob.size / 1024 / 1024).toFixed(2);
                statusEl.textContent = `✅ 已导出独立全量包：${safeBase}.stcapsule.json (${mb} MB)`;
                if (window.toastr) window.toastr.success(`已导出 ${safeBase}.stcapsule.json (${mb} MB)`);
            }
        } catch (err) {
            console.error('[ST-Capsule] Export error:', err);
            statusEl.textContent = `❌ 导出失败：${err.message || err}`;
            if (window.toastr) window.toastr.error(String(err.message || err));
        } finally {
            btnPng.disabled = false;
            btnJson.disabled = false;
            if (btnShare) btnShare.disabled = false;
        }
    }

    function renderImportTab() {
        loadedImport = null;
        bodyEl.innerHTML = `
          <div class="stcap-dropzone" id="stcap-dropzone">
            <div style="font-size:28px;margin-bottom:8px;">📥</div>
            <div style="font-size:14px;font-weight:700;color:#e2e8f0;">点击选择或拖入 <code>.capsule.png</code> / <code>.stcapsule.json</code> / 普通角色卡 <code>.png</code></div>
            <div style="font-size:12px;color:#94a3b8;margin-top:6px;">支持完整解析并按需勾选还原：角色卡本体、多本世界书及绑定关系、预设、全局/局部正则、全部历史聊天分支</div>
            <input type="file" id="stcap-file-input" accept=".png,.json" style="display:none" />
          </div>
          <div id="stcap-import-preview"></div>
        `;
        footerEl.innerHTML = `
          <div class="stcap-status" id="stcap-import-status">等待载入胶囊文件...</div>
          <div class="stcap-export-btns">
            <button class="stcap-action-btn" id="stcap-btn-restore" disabled>⚡ 一键还原勾选项到酒馆</button>
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
            loadedImport = parsed.capsule;
            const cap = loadedImport;
            const books = cap.worldbooks?.books || [];
            const chats = cap.chats || [];
            const presets = cap.presets?.items || [];
            const gRegex = cap.regex?.global || [];
            const sRegex = cap.regex?.scoped || [];

            previewEl.innerHTML = `
              <div class="stcap-grid" style="margin-top:8px;">
                <div class="stcap-section">
                  <div class="stcap-section-title">👤 角色与基础项</div>
                  <label class="stcap-item">
                    <input type="checkbox" id="stcap-res-char" checked />
                    <span class="stcap-item-label">导入角色卡：${escapeHtml(cap.character?.name || '未知')}</span>
                  </label>
                  <label class="stcap-item">
                    <input type="checkbox" id="stcap-res-gregex" ${gRegex.length ? 'checked' : 'disabled'} />
                    <span class="stcap-item-label">合并全局正则 (${gRegex.length} 条，按 ID 去重)</span>
                  </label>
                  <div style="font-size:11px;color:#94a3b8;padding:4px 8px;">角色局部正则 ${sRegex.length} 条随角色卡自动携带。</div>
                </div>

                <div class="stcap-section">
                  <div class="stcap-section-title">🌍 包含的世界书 (${books.length} 本)</div>
                  <div class="stcap-list">
                    ${books.length ? books.map((b, i) => `
                      <label class="stcap-item">
                        <input type="checkbox" class="stcap-res-wb" value="${i}" checked />
                        <span class="stcap-item-label">${escapeHtml(b.name)}</span>
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
                  <div class="stcap-section-title">💬 包含的聊天记录 (${chats.length} 段)</div>
                  <div class="stcap-list">
                    ${chats.length ? chats.map((c, i) => `
                      <label class="stcap-item">
                        <input type="checkbox" class="stcap-res-chat" value="${i}" checked />
                        <span class="stcap-item-label">${escapeHtml(c.file_id)}</span>
                        <span class="stcap-item-sub">${c.message_count ?? (c.messages?.length || 0)} 条</span>
                      </label>
                    `).join('') : '<div style="color:#64748b;font-size:12px;padding:6px;">无聊天记录</div>'}
                  </div>
                </div>
              </div>
            `;
            statusEl.textContent = `解析成功：${cap.character?.name || file.name}（导出时间：${cap.exported_at || '未知'}）`;
            restoreBtn.disabled = false;
            restoreBtn.onclick = () => executeRestore(cap);
        } catch (err) {
            console.error('[ST-Capsule] Import parse error:', err);
            previewEl.innerHTML = '';
            statusEl.textContent = `❌ 解析失败：${err.message || err}`;
            restoreBtn.disabled = true;
        }
    }

    async function executeRestore(cap) {
        const statusEl = footerEl.querySelector('#stcap-import-status');
        const restoreBtn = footerEl.querySelector('#stcap-btn-restore');
        restoreBtn.disabled = true;
        try {
            // 1. Restore Worldbooks first so bindings work
            const wbIndices = [...bodyEl.querySelectorAll('.stcap-res-wb:checked')].map(c => Number(c.value));
            for (const idx of wbIndices) {
                const wb = cap.worldbooks.books[idx];
                if (!wb?.name || !wb?.data) continue;
                statusEl.textContent = `正在写入世界书：${wb.name}...`;
                await apiPost('/api/worldinfo/edit', { name: wb.name, data: wb.data });
            }

            // 2. Restore Character Card if checked
            let targetAvatar = cap.character?.avatar || `${ sanitizeDownloadName(cap.character?.name || 'Character') }.png`;
            if (bodyEl.querySelector('#stcap-res-char')?.checked && cap.character?.card) {
                statusEl.textContent = `正在导入角色卡：${cap.character.name}...`;
                let pngBytes = cap._raw_png_bytes;
                if (!pngBytes && cap.character.avatar_png_base64) {
                    pngBytes = base64ToUint8(cap.character.avatar_png_base64);
                }
                if (!pngBytes) {
                    pngBytes = await createFallbackPngBytes(cap.character.name);
                }
                // Write clean standard V2/V3 card PNG for SillyTavern character import
                const cleanChunks = extractPngChunks(pngBytes).filter(ch => {
                    if (ch.name !== 'tEXt') return true;
                    const dec = decodeTextChunk(ch.data);
                    return !dec || !['chara', 'ccv3', 'st_capsule'].includes(dec.keyword.toLowerCase());
                });
                const v2Str = JSON.stringify(cap.character.card);
                const iend = cleanChunks.findIndex(c => c.name === 'IEND');
                cleanChunks.splice(iend >= 0 ? iend : cleanChunks.length, 0, makeTextChunk('chara', utf8ToBase64(v2Str)));
                const cleanPng = encodePngChunks(cleanChunks);

                const fd = new FormData();
                fd.append('avatar', new Blob([cleanPng], { type: 'image/png' }), targetAvatar);
                fd.append('file_type', 'png');
                const headers = ctx.getRequestHeaders ? { ...ctx.getRequestHeaders() } : {};
                delete headers['Content-Type'];
                const impResp = await fetch('/api/characters/import', { method: 'POST', headers, body: fd });
                if (impResp.ok) {
                    const impJson = await impResp.json();
                    if (impJson?.file_name) targetAvatar = `${impJson.file_name}.png`;
                }
            }

            // Restore extraBooks world_info.charLore binding
            const extraBooks = cap.worldbooks?.bindings?.extra || [];
            if (extraBooks.length > 0 && world_info) {
                const charKey = targetAvatar.replace(/\.png$/i, '');
                world_info.charLore = world_info.charLore || [];
                const existing = world_info.charLore.find(e => e.name === charKey);
                if (existing) {
                    existing.extraBooks = [...new Set([...(existing.extraBooks || []), ...extraBooks])];
                } else {
                    world_info.charLore.push({ name: charKey, extraBooks: [...extraBooks] });
                }
                ctx.saveSettingsDebounced?.();
            }

            // 3. Restore Presets
            const presetIndices = [...bodyEl.querySelectorAll('.stcap-res-preset:checked')].map(c => Number(c.value));
            const pm = getPresetManager?.();
            for (const idx of presetIndices) {
                const p = cap.presets.items[idx];
                if (p?.name && p?.data && pm?.savePreset) {
                    statusEl.textContent = `正在写入预设：${p.name}...`;
                    await pm.savePreset(p.name, p.data);
                }
            }

            // 4. Restore Global Regex (dedup by id)
            if (bodyEl.querySelector('#stcap-res-gregex')?.checked && Array.isArray(cap.regex?.global)) {
                extension_settings.regex = extension_settings.regex || [];
                const existingIds = new Set(extension_settings.regex.map(r => r.id));
                for (const rx of cap.regex.global) {
                    if (rx && !existingIds.has(rx.id)) {
                        extension_settings.regex.push(rx);
                    }
                }
                ctx.saveSettingsDebounced?.();
            }

            // 5. Restore Chat Histories
            const chatIndices = [...bodyEl.querySelectorAll('.stcap-res-chat:checked')].map(c => Number(c.value));
            for (const idx of chatIndices) {
                const ch = cap.chats[idx];
                if (!ch?.file_id || !Array.isArray(ch.messages)) continue;
                statusEl.textContent = `正在恢复聊天分支：${ch.file_id}...`;
                await apiPost('/api/chats/save', {
                    ch_name: cap.character?.name || 'Character',
                    file_name: ch.file_id,
                    chat: ch.messages,
                    avatar_url: targetAvatar,
                    force: true,
                });
            }

            if (typeof ctx.getCharacters === 'function') await ctx.getCharacters();
            statusEl.textContent = `✅ 还原完成！已写入 ${wbIndices.length} 本世界书、${presetIndices.length} 套预设、${chatIndices.length} 段聊天记录。`;
            if (window.toastr) window.toastr.success('全量胶囊还原成功');
        } catch (err) {
            console.error('[ST-Capsule] Restore error:', err);
            statusEl.textContent = `❌ 还原出错：${err.message || err}`;
            if (window.toastr) window.toastr.error(String(err.message || err));
        } finally {
            restoreBtn.disabled = false;
        }
    }

    if (activeTab === 'export') await renderExportTab();
    else renderImportTab();
}

// ============================================================================
// Extension Mounting (Drawer + Wand Menu + Character Panel + Slash Command)
// ============================================================================
jQuery(async () => {
    // 1. Settings Drawer Panel
    const settingsHtml = `
      <div class="extension_container" id="st_capsule_packer_container">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>📦 酒馆全量胶囊打包器 (ST Capsule Packer)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content stcap-drawer-box">
            <div style="color:#94a3b8;line-height:1.5;">
              将角色卡、当前预设、全局/局部正则、酒馆助手脚本、绑定的多本世界书与所有历史聊天记录一键压入单张 <code>.capsule.png</code> 角色卡或独立 <code>.stcapsule.json</code> 备份文件，可直接拖入 Antigravity 检视台或随时还原。
            </div>
            <div class="stcap-btn-row">
              <button class="stcap-trigger-btn primary" id="stcap-open-export">📤 打包导出当前角色</button>
              <button class="stcap-trigger-btn" id="stcap-open-import">📥 读取 / 还原胶囊</button>
            </div>
          </div>
        </div>
      </div>
    `;
    $('#extensions_settings2').append(settingsHtml);
    $('#stcap-open-export').on('click', () => openCapsuleModal('export'));
    $('#stcap-open-import').on('click', () => openCapsuleModal('import'));

    // 2. Bottom-Left Wand / Extensions Menu (#extensionsMenu) — Mobile & Luker UI friendly!
    if ($('#extensionsMenu').length && !$('#stcap-wand-item').length) {
        const wandItem = $(`
          <div id="stcap-wand-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-box-archive extensionsMenuExtensionButton"></div>
            <span>全量角色胶囊打包 / 还原</span>
          </div>
        `);
        wandItem.on('click', () => {
            $('#extensionsMenu').hide();
            openCapsuleModal('export');
        });
        $('#extensionsMenu').append(wandItem);
    }

    // 3. Character Right Panel Quick Button (next to export_button)
    if ($('#export_button').length && !$('#stcap-char-btn').length) {
        const charBtn = $(`<div id="stcap-char-btn" class="menu_button fa-solid fa-box-archive interactable" title="打包全量角色胶囊 (含预设/正则/多世界书/全部聊天)" tabindex="0"></div>`);
        charBtn.on('click', () => openCapsuleModal('export'));
        $('#export_button').after(charBtn);
    }

    // 4. Slash Command /capsule
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
        } catch (e) {
            console.warn('[ST-Capsule] Slash command registration warning:', e);
        }
    }
    console.log(`[${EXT_ID}] Loaded successfully.`);
});
