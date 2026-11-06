import { observeAttributes, observeElement } from '../../core/observer.js';
import { settings } from '../../core/settings/getSettings.js';
import { loadAssetTree } from '../../core/utils/assetStreamer.js';

const WIDGET_CLASS = 'rovalra-card-asset-id-wrapper';
const INPUT_CLASS = 'rovalra-card-asset-id-input';
const COPY_BTN_CLASS = 'rovalra-card-asset-id-copy';

function formatAssetUri(id) {
    if (!id) return '';
    return String(id).startsWith('rbxassetid://') ? String(id) : `rbxassetid://${id}`;
}

function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

function createCopyIcon() {
    const svg = createSvgElement('svg', {
        viewBox: '0 0 24 24',
        width: '13',
        height: '13',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    });
    const rect = createSvgElement('rect', {
        x: '9',
        y: '9',
        width: '13',
        height: '13',
        rx: '2',
        ry: '2',
    });
    const path = createSvgElement('path', {
        d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    });
    svg.append(rect, path);
    return svg;
}

function createCheckIcon() {
    const svg = createSvgElement('svg', {
        viewBox: '0 0 24 24',
        width: '13',
        height: '13',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
    });
    const polyline = createSvgElement('polyline', {
        points: '20 6 9 17 4 12',
    });
    svg.appendChild(polyline);
    return svg;
}

const resolvedCache = new Map();
const pendingBatch = new Set();
let batchTimer = null;

function extractCardInfo(card) {
    const link = card.querySelector(
        'a.item-card-link, a.rovalra-item-card-link, a[href*="/catalog/"], a[href*="/bundles/"]',
    );
    if (!link || !link.href) return null;

    const match = link.href.match(/\/(catalog|bundles)\/(\d+)/i);
    if (!match) return null;

    return {
        type: match[1].toLowerCase() === 'bundles' ? 'Bundle' : 'Asset',
        catalogId: match[2],
        link,
        href: link.href,
    };
}

function findAnimationId(instances) {
    if (!instances || !Array.isArray(instances)) return null;
    const queue = [...instances];
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node) continue;
        if (node.ClassName === 'Animation' && node.Properties?.AnimationId) {
            const m = String(node.Properties.AnimationId).match(
                /(?:rbxassetid:\/\/|\/asset\/?\?id=|assetid=|[?&]id=)?(\d+)/i,
            );
            if (m && m[1]) return m[1];
        }
        if (Array.isArray(node.Children)) {
            queue.push(...node.Children);
        }
    }
    return null;
}

function updateCardsWithId(catalogId, resolvedId, isAnimation) {
    const wrappers = document.querySelectorAll(
        `.${WIDGET_CLASS}[data-catalog-id="${catalogId}"]`,
    );
    const formattedId = formatAssetUri(resolvedId);
    wrappers.forEach((wrapper) => {
        const input = wrapper.querySelector(`.${INPUT_CLASS}`);
        if (!input) return;
        input.value = formattedId;
        input.title = isAnimation
            ? `Animation Asset ID: ${formattedId} (Catalog: ${catalogId})`
            : `Asset ID: ${formattedId}`;
        wrapper.dataset.resolvedId = resolvedId;
    });
}

async function processBatch() {
    const ids = [...pendingBatch];
    pendingBatch.clear();
    if (!ids.length) return;

    const concurrency = 4;
    for (let i = 0; i < ids.length; i += concurrency) {
        const chunk = ids.slice(i, i + concurrency);
        await Promise.all(
            chunk.map(async (catalogId) => {
                try {
                    const tree = await loadAssetTree(parseInt(catalogId, 10));
                    if (tree?.isValid && tree.root) {
                        const animId = findAnimationId(tree.root);
                        if (animId) {
                            resolvedCache.set(catalogId, animId);
                            updateCardsWithId(catalogId, animId, true);
                            return;
                        }
                    }
                } catch {
                    // Ignore resolution errors, fallback to catalog ID
                }
                resolvedCache.set(catalogId, catalogId);
            }),
        );
    }
}

function queueAssetResolution(catalogId) {
    if (resolvedCache.has(catalogId)) return;
    pendingBatch.add(catalogId);
    clearTimeout(batchTimer);
    batchTimer = setTimeout(processBatch, 60);
}

function insertWidget(card, wrapper) {
    const priceEl = card.querySelector(
        '.item-card-price, .text-overflow.item-card-price, .rovalra-item-rap, .text-robux-tile, .item-card-price-container',
    );
    if (priceEl) {
        priceEl.after(wrapper);
    } else {
        const caption = card.querySelector('.item-card-caption');
        if (caption) {
            caption.appendChild(wrapper);
        } else {
            card.appendChild(wrapper);
        }
    }
}

function createWidget(catalogId) {
    const wrapper = document.createElement('div');
    wrapper.className = WIDGET_CLASS;
    wrapper.dataset.catalogId = catalogId;

    const currentId = resolvedCache.get(catalogId) || catalogId;
    const isAnim = resolvedCache.has(catalogId) && currentId !== catalogId;
    const formattedId = formatAssetUri(currentId);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = INPUT_CLASS;
    input.readOnly = true;
    input.value = formattedId;
    input.spellcheck = false;
    input.title = isAnim
        ? `Animation Asset ID: ${formattedId} (Catalog: ${catalogId})`
        : `Asset ID: ${formattedId}`;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = COPY_BTN_CLASS;
    copyBtn.title = 'Copy Asset ID';
    copyBtn.setAttribute('aria-label', 'Copy Asset ID');
    copyBtn.appendChild(createCopyIcon());

    // Prevent navigation when interacting with input or button
    const stopPropagation = (e) => e.stopPropagation();
    wrapper.addEventListener('click', stopPropagation);
    wrapper.addEventListener('mousedown', stopPropagation);
    wrapper.addEventListener('pointerdown', stopPropagation);

    input.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.select();
    });

    copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const valueToCopy = input.value;
        if (!valueToCopy) return;

        try {
            await navigator.clipboard.writeText(valueToCopy);
            copyBtn.classList.add('copied');
            copyBtn.title = 'Copied!';
            copyBtn.replaceChildren(createCheckIcon());
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.title = 'Copy Asset ID';
                copyBtn.replaceChildren(createCopyIcon());
            }, 1500);
        } catch (err) {
            console.warn('RoValra: Failed to copy asset ID to clipboard', err);
        }
    });

    wrapper.append(input, copyBtn);
    return wrapper;
}

function processCard(card) {
    const info = extractCardInfo(card);
    if (!info) return;

    const existing = card.querySelector(`:scope > .${WIDGET_CLASS}, .item-card-caption > .${WIDGET_CLASS}, .${WIDGET_CLASS}`);
    if (existing) {
        if (existing.dataset.catalogId === info.catalogId) {
            // Already initialized for this catalog item
            return;
        }
        // Recycled card: update to new catalog ID
        existing.dataset.catalogId = info.catalogId;
        const input = existing.querySelector(`.${INPUT_CLASS}`);
        if (input) {
            const currentId = resolvedCache.get(info.catalogId) || info.catalogId;
            const isAnim = resolvedCache.has(info.catalogId) && currentId !== info.catalogId;
            const formattedId = formatAssetUri(currentId);
            input.value = formattedId;
            input.title = isAnim
                ? `Animation Asset ID: ${formattedId} (Catalog: ${info.catalogId})`
                : `Asset ID: ${formattedId}`;
        }
        queueAssetResolution(info.catalogId);
        return;
    }

    const widget = createWidget(info.catalogId);
    insertWidget(card, widget);
    queueAssetResolution(info.catalogId);
}

export async function init() {
    if (!(await settings.catalogCardAssetIdEnabled)) return;

    observeElement(
        '.item-card-container, .rovalra-item-card, .catalog-item-card, .item-card',
        (card) => {
            processCard(card);
            const link = card.querySelector('a.item-card-link, a.rovalra-item-card-link, a[href*="/catalog/"], a[href*="/bundles/"]');
            if (link) {
                observeAttributes(link, () => processCard(card), ['href']);
            }
        },
        { multiple: true },
    );
}
