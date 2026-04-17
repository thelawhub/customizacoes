// ==UserScript==
// @name         Customizações
// @namespace    projudi-customizacoes.user.js
// @version      4.5
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Centraliza customizações visuais, navegação, scrollbar e destaques de movimentações do Projudi.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://raw.githubusercontent.com/thelawhub/customizacoes/refs/heads/main/projudi-customizacoes.user.js
// @downloadURL  https://raw.githubusercontent.com/thelawhub/customizacoes/refs/heads/main/projudi-customizacoes.user.js
// @match        *://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_KEY = "projudi-wide-settings-v1";
    const SCRIPT_META = (() => {
        const fallbackName = "Customizacoes";
        const fallbackId = "projudi-customizacoes";
        try {
            const script = GM_info && GM_info.script ? GM_info.script : {};
            const name = String(script.name || fallbackName).trim() || fallbackName;
            const namespace = String(script.namespace || "").trim();
            const version = String(script.version || "unknown").trim() || "unknown";
            const base = (namespace || name || fallbackId)
                .replace(/\.user\.js$/i, "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .toLowerCase();
            const id = base || fallbackId;
            return { name, version, id, fileName: `${id}.json` };
        } catch (_) {
            return { name: fallbackName, version: "unknown", id: fallbackId, fileName: `${fallbackId}.json` };
        }
    })();
    const BACKUP_STORAGE_KEY = "projudi-wide-settings-v1::gist-backup";
    const BACKUP_SCHEMA = "projudi-customizacoes-backup-v1";
    const OPEN_SETTINGS_MESSAGE = "projudi-customizacoes-open-settings";
    const LOG_PREFIX = "[Customizações]";
    const DEFAULT_SETTINGS = {
        enabled: true,
        autoHideHeader: false,
        enableIframeAutoHeight: false,
        openProcessFilesInPopup: false,
        popupSizePercent: 98,
        enableWidthAdjustments: false,
        contentWidthPercent: 100,
        headerWidthPercent: 100,
        centerContent: true,
        compactMode: false,
        fontScaleEnabled: false,
        fontScalePercent: 100,
        sideBackgroundEnabled: false,
        sideBackground: "original",
        hideClock: false,
        hideHeaderIcons: false,
        applyToStandalonePages: false,
        enableProcessMirrorPdf: true,
        enableRemoveScrollbar: false,
        enableMovimentacoes: false
    };
    const DEFAULT_BACKUP_SETTINGS = {
        enabled: false,
        gistId: "",
        token: "",
        fileName: SCRIPT_META.fileName,
        autoBackupOnSave: false,
        lastBackupAt: ""
    };

    const OPTOUT_ATTR = "data-projudi-wide-optout";
    let settings = loadSettings();
    let isInitialized = false;
    let headerRevealZone = null;
    let boundIframeEl = null;
    let boundAutoHideIframeEl = null;
    let iframeAvailabilityObserver = null;
    let standaloneDomObserver = null;
    let pendingIframeRetryTimers = [];
    let iframeRetryRunId = 0;
    let topDomWorkScheduled = false;
    let standaloneDomWorkScheduled = false;
    let mouseMoveListenerBound = false;
    let menuCommandId = null;
    let popupHookedDoc = null;
    let popupHookCleanup = null;
    let popupOwnerDoc = null;
    let popupDock = null;
    let popupDockToggle = null;
    let popupDockMenu = null;
    let popupWindowCounter = 0;
    const popupWindows = new Map();
    let popupBackdrop = null;
    let popupUnlockBodyScroll = null;
    let popupActiveId = null;
    let popupPrintCleanup = null;
    let popupContextObserver = null;
    let popupContextObservedDoc = null;
    let popupContextSyncScheduled = false;
    let mirrorPdfObserver = null;
    let mirrorPdfWorkScheduled = false;
    let mirrorPdfDepsPromise = null;
    let movimentacoesModule = null;
    const NO_SCROLLBAR_STYLE_ID = "tm-no-scrollbar-style";
    const NO_SCROLLBAR_CSS = "html,body{-ms-overflow-style:none!important;scrollbar-width:none!important;}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important;}";

    function logInfo(message, meta) {
        if (typeof console === "undefined" || typeof console.info !== "function") return;
        if (meta === undefined) {
            console.info(`${LOG_PREFIX} ${message}`);
            return;
        }
        console.info(`${LOG_PREFIX} ${message}`, meta);
    }

    function logWarn(message, meta) {
        if (typeof console === "undefined" || typeof console.warn !== "function") return;
        if (meta === undefined) {
            console.warn(`${LOG_PREFIX} ${message}`);
            return;
        }
        console.warn(`${LOG_PREFIX} ${message}`, meta);
    }

    function logError(message, error) {
        if (typeof console === "undefined" || typeof console.error !== "function") return;
        console.error(`${LOG_PREFIX} ${message}`, error);
    }

    function safeRun(label, task, fallbackValue) {
        try {
            return task();
        } catch (error) {
            logError(label, error);
            return fallbackValue;
        }
    }

    function onIframeLoad() {
        retryInjectInIframe(14, 220);
        syncPopupModeFromIframeContext();
    }

    function onIframeMouseEnter() {
        if (!settings.enabled || !settings.autoHideHeader) return;
        setHeaderHidden(true);
    }

    function onDocumentMouseMove(e) {
        if (!settings.enabled || !settings.autoHideHeader) return;
        if (e.clientY < 80) setHeaderHidden(false);
    }

    function rememberTimeout(id) {
        pendingIframeRetryTimers.push(id);
        return id;
    }

    function clearPendingIframeRetryTimers() {
        if (!pendingIframeRetryTimers.length) return;
        pendingIframeRetryTimers.forEach(id => clearTimeout(id));
        pendingIframeRetryTimers = [];
    }

    function formatLastBackupLabel(value) {
        if (!value) return "Último backup: ainda não enviado.";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Último backup: ainda não enviado.";
        return `Último backup: ${date.toLocaleString("pt-BR")}.`;
    }

    function shouldManageIframeFeatures() {
        return !!(
            settings.enableIframeAutoHeight ||
            settings.autoHideHeader ||
            settings.enableWidthAdjustments ||
            settings.openProcessFilesInPopup ||
            settings.enableProcessMirrorPdf ||
            settings.enableRemoveScrollbar
        );
    }

    function isTopWindow() {
        return window.top === window.self;
    }

    function lockBodyScroll(doc = document) {
        const body = doc && doc.body;
        const html = doc && doc.documentElement;
        if (!body || !html) return () => {};
        const win = (doc && doc.defaultView) || window;
        const KEY = "__pjBodyScrollLock__";
        const state = win[KEY] || (win[KEY] = {
            count: 0,
            prevBodyOverflow: "",
            prevHtmlOverflow: "",
            prevBodyOverscroll: "",
            prevHtmlOverscroll: ""
        });
        if (state.count === 0) {
            state.prevBodyOverflow = body.style.overflow;
            state.prevHtmlOverflow = html.style.overflow;
            state.prevBodyOverscroll = body.style.overscrollBehavior;
            state.prevHtmlOverscroll = html.style.overscrollBehavior;
            body.style.overflow = "hidden";
            html.style.overflow = "hidden";
            body.style.overscrollBehavior = "none";
            html.style.overscrollBehavior = "none";
        }
        state.count += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            state.count = Math.max(0, state.count - 1);
            if (state.count === 0) {
                body.style.overflow = state.prevBodyOverflow;
                html.style.overflow = state.prevHtmlOverflow;
                body.style.overscrollBehavior = state.prevBodyOverscroll;
                html.style.overscrollBehavior = state.prevHtmlOverscroll;
            }
        };
    }

    function loadSettings() {
        try {
            if (typeof GM_getValue === "function") {
                const raw = GM_getValue(STORAGE_KEY, "");
                if (!raw) return normalizeSettings(DEFAULT_SETTINGS);
                return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
            }
        } catch (error) {
            logWarn("Falha ao carregar configurações; usando padrão.", error);
        }
        return normalizeSettings(DEFAULT_SETTINGS);
    }

    function saveSettings(next) {
        settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...next });
        if (typeof GM_setValue === "function") {
            try {
                GM_setValue(STORAGE_KEY, JSON.stringify(settings));
            } catch (error) {
                logError("Falha ao salvar configurações.", error);
            }
        }
    }

    function normalizeBackupSettings(value) {
        const next = { ...DEFAULT_BACKUP_SETTINGS, ...(value || {}) };
        next.enabled = !!next.enabled;
        next.gistId = String(next.gistId || "").trim();
        next.token = String(next.token || "").trim();
        next.fileName = String(next.fileName || SCRIPT_META.fileName).trim() || SCRIPT_META.fileName;
        next.autoBackupOnSave = !!next.autoBackupOnSave;
        next.lastBackupAt = String(next.lastBackupAt || "").trim();
        return next;
    }

    function loadBackupSettings() {
        try {
            if (typeof GM_getValue === "function") {
                const raw = GM_getValue(BACKUP_STORAGE_KEY, "");
                if (!raw) return normalizeBackupSettings(DEFAULT_BACKUP_SETTINGS);
                return normalizeBackupSettings(JSON.parse(raw));
            }
        } catch (error) {
            logWarn("Falha ao carregar configuração de backup; usando padrão.", error);
        }
        return normalizeBackupSettings(DEFAULT_BACKUP_SETTINGS);
    }

    function saveBackupSettings(next) {
        const normalized = normalizeBackupSettings(next);
        if (typeof GM_setValue === "function") {
            try {
                GM_setValue(BACKUP_STORAGE_KEY, JSON.stringify(normalized));
            } catch (error) {
                logError("Falha ao salvar configuração de backup.", error);
            }
        }
        return normalized;
    }

    function buildBackupPayload(nextSettings = settings) {
        return {
            schema: BACKUP_SCHEMA,
            scriptId: SCRIPT_META.id,
            scriptName: SCRIPT_META.name,
            version: SCRIPT_META.version,
            exportedAt: new Date().toISOString(),
            host: location.host,
            settings: normalizeSettings(nextSettings)
        };
    }

    function applyBackupPayload(payload) {
        if (!payload || typeof payload !== "object") throw new Error("Backup inválido.");
        const nextSettings = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;
        saveSettings(nextSettings);
        settings = loadSettings();
        applySettingsNow();
        return settings;
    }

    function githubRequest(options) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("GM_xmlhttpRequest indisponível."));
                return;
            }
            GM_xmlhttpRequest({
                method: options.method || "GET",
                url: options.url,
                headers: options.headers || {},
                data: options.data,
                onload: (response) => resolve(response),
                onerror: () => reject(new Error("Falha de rede ao acessar o GitHub.")),
                ontimeout: () => reject(new Error("Tempo esgotado ao acessar o GitHub."))
            });
        });
    }

    function parseGithubError(response) {
        try {
            const parsed = JSON.parse(response.responseText || "{}");
            if (parsed && parsed.message) return parsed.message;
        } catch (_) {}
        return `GitHub respondeu com status ${response.status}.`;
    }

    async function pushBackupToGist(backupSettings, payload) {
        if (!backupSettings.gistId) throw new Error("Informe o Gist ID.");
        if (!backupSettings.token) throw new Error("Informe o token do GitHub.");
        const response = await githubRequest({
            method: "PATCH",
            url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
            headers: {
                "Accept": "application/vnd.github+json",
                "Authorization": `Bearer ${backupSettings.token}`,
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                files: {
                    [backupSettings.fileName]: {
                        content: JSON.stringify(payload, null, 2)
                    }
                }
            })
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(parseGithubError(response));
        }
        return JSON.parse(response.responseText || "{}");
    }

    async function readBackupFromGist(backupSettings) {
        if (!backupSettings.gistId) throw new Error("Informe o Gist ID.");
        if (!backupSettings.token) throw new Error("Informe o token do GitHub.");
        const response = await githubRequest({
            method: "GET",
            url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
            headers: {
                "Accept": "application/vnd.github+json",
                "Authorization": `Bearer ${backupSettings.token}`
            }
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(parseGithubError(response));
        }
        const gist = JSON.parse(response.responseText || "{}");
        const file = gist && gist.files ? gist.files[backupSettings.fileName] : null;
        if (!file || !file.content) throw new Error("Arquivo de backup não encontrado no Gist.");
        return JSON.parse(file.content);
    }

    function normalizeSettings(value) {
        const next = { ...DEFAULT_SETTINGS, ...(value || {}) };
        next.enabled = next.enabled !== false;
        next.autoHideHeader = !!next.autoHideHeader;
        next.enableIframeAutoHeight = !!next.enableIframeAutoHeight;
        next.openProcessFilesInPopup = !!next.openProcessFilesInPopup;
        next.popupSizePercent = sanitizePopupSize(next.popupSizePercent);
        next.enableWidthAdjustments = !!next.enableWidthAdjustments;
        next.contentWidthPercent = sanitizeWidthPercent(next.contentWidthPercent);
        next.headerWidthPercent = sanitizeWidthPercent(next.headerWidthPercent);
        next.centerContent = true;
        next.compactMode = !!next.compactMode;
        next.fontScaleEnabled = !!next.fontScaleEnabled;
        next.fontScalePercent = sanitizeFontScale(next.fontScalePercent);
        next.sideBackgroundEnabled = !!next.sideBackgroundEnabled;
        next.sideBackground = sanitizeSideBackground(next.sideBackground);
        next.hideClock = !!next.hideClock;
        next.hideHeaderIcons = !!next.hideHeaderIcons;
        next.applyToStandalonePages = !!next.applyToStandalonePages;
        next.enableProcessMirrorPdf = next.enableProcessMirrorPdf !== false;
        next.enableRemoveScrollbar = !!next.enableRemoveScrollbar;
        next.enableMovimentacoes = !!next.enableMovimentacoes;
        return next;
    }

    function sanitizeWidthPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.contentWidthPercent;
        return Math.max(60, Math.min(100, Math.round(n)));
    }

    function sanitizePopupSize(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.popupSizePercent;
        return Math.max(60, Math.min(100, Math.round(n)));
    }

    function sanitizeFontScale(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.fontScalePercent;
        return [90, 100, 110].includes(n) ? n : DEFAULT_SETTINGS.fontScalePercent;
    }

    function sanitizeSideBackground(value) {
        return ["original", "white", "light"].includes(value)
            ? value
            : DEFAULT_SETTINGS.sideBackground;
    }

    function registerMenu() {
        if (typeof GM_registerMenuCommand !== "function") return;
        try {
            const previousId = menuCommandId;
            const nextId = GM_registerMenuCommand("Gerenciar Customizações", () => {
                if (isTopWindow()) {
                    openSettingsPanel();
                    return;
                }
                try {
                    window.top.postMessage({ type: OPEN_SETTINGS_MESSAGE }, "*");
                } catch (_) {}
            });
            if (nextId != null) menuCommandId = nextId;
            if (nextId != null && previousId && previousId !== menuCommandId && typeof GM_unregisterMenuCommand === "function") {
                try {
                    GM_unregisterMenuCommand(previousId);
                } catch (_) {}
            }
        } catch (_) {}
    }

    function openSettingsPanel() {
        if (!isTopWindow()) return;
        if (document.getElementById("projudi-wide-panel-overlay")) return;

        let backupSettings = loadBackupSettings();
        const unlockBodyScroll = lockBodyScroll(document);
        const overlay = document.createElement("div");
        overlay.id = "projudi-wide-panel-overlay";
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(11, 18, 32, .50); z-index: 2147483647;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            padding: 18px;
        `;

        const panel = document.createElement("div");
        panel.className = "pjc-panel";
        panel.style.cssText = `
            width: 640px; max-width: calc(100vw - 24px); background: #ffffff; color: #0f172a;
            border-radius: 14px; box-shadow: 0 24px 70px rgba(2, 6, 23, .30);
            border: 1px solid #dbe3ef;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            font-size: 14px;
            line-height: 1.35;
            overflow: hidden;
            max-height: min(88vh, 860px);
            display: flex;
            flex-direction: column;
            transform: translateY(6px) scale(.985);
            opacity: .96;
            transition: transform .16s ease, opacity .16s ease;
        `;

        const scopedStyle = document.createElement("style");
        scopedStyle.textContent = `
            #projudi-wide-panel-overlay .pjc-panel *,
            #projudi-wide-panel-overlay .pjc-panel *::before,
            #projudi-wide-panel-overlay .pjc-panel *::after {
                box-sizing: border-box;
            }

            #projudi-wide-panel-overlay #pj-reset,
            #projudi-wide-panel-overlay #pj-cancel,
            #projudi-wide-panel-overlay #pj-save,
            #projudi-wide-panel-overlay #pj-close {
                text-indent: 0 !important;
                letter-spacing: normal !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                text-transform: none !important;
                line-height: 1.2 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
                white-space: nowrap !important;
            }

            #projudi-wide-panel-overlay #pj-reset,
            #projudi-wide-panel-overlay #pj-cancel {
                color: #1e293b !important;
                background: #ffffff !important;
                border: 1px solid #cbd5e1 !important;
            }

            #projudi-wide-panel-overlay #pj-save {
                color: #ffffff !important;
                background: #0f3e75 !important;
                border: 1px solid #0f3e75 !important;
            }

            #projudi-wide-panel-overlay #pj-close {
                color: #ffffff !important;
            }

            #projudi-wide-panel-overlay input[type="number"] {
                color: #0f172a !important;
                background: #ffffff !important;
                border: 1px solid #cbd5e1 !important;
                font: inherit !important;
            }

            #projudi-wide-panel-overlay #pj-panel-body {
                overflow: auto !important;
                max-height: calc(min(88vh, 860px) - 122px - 72px) !important;
                padding: 16px !important;
                background: linear-gradient(180deg, #f8fbff 0%, #f2f6fc 100%) !important;
            }

            #projudi-wide-panel-overlay #pj-panel-header {
                flex: 0 0 auto !important;
            }

            #projudi-wide-panel-overlay #pj-panel-footer {
                flex: 0 0 auto !important;
                position: sticky !important;
                bottom: 0 !important;
                z-index: 2 !important;
                background: #f8fafc !important;
            }

            #projudi-wide-panel-overlay select {
                color: #0f172a !important;
                background: #ffffff !important;
                border: 1px solid #cbd5e1 !important;
                font: inherit !important;
            }

            #projudi-wide-panel-overlay label,
            #projudi-wide-panel-overlay input,
            #projudi-wide-panel-overlay select,
            #projudi-wide-panel-overlay button {
                font-family: inherit !important;
            }

            #projudi-wide-panel-overlay .pjc-body {
                display: flex;
                flex-direction: column;
                gap: 14px;
            }

            #projudi-wide-panel-overlay .pjc-section {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            #projudi-wide-panel-overlay .pjc-section-title {
                margin: 0 0 0 2px;
                color: #334155;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: .03em;
                text-transform: uppercase;
            }

            #projudi-wide-panel-overlay .pjc-stack {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            #projudi-wide-panel-overlay .pjc-card {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 14px;
                border: 1px solid #dbe3ef;
                border-radius: 12px;
                background: #ffffff;
                box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
            }

            #projudi-wide-panel-overlay .pjc-card--soft {
                background: #f8fbff;
            }

            #projudi-wide-panel-overlay .pjc-card-body {
                min-width: 0;
                flex: 1;
            }

            #projudi-wide-panel-overlay .pjc-card-title {
                margin: 0;
                color: #0f172a;
                font-size: 14px;
                font-weight: 700;
                line-height: 1.25;
            }

            #projudi-wide-panel-overlay .pjc-card-desc {
                margin: 3px 0 0;
                color: #64748b;
                font-size: 12px;
                line-height: 1.4;
            }

            #projudi-wide-panel-overlay .pjc-card-check {
                width: 18px;
                height: 18px;
                margin-top: 2px;
                flex: 0 0 auto;
            }

            #projudi-wide-panel-overlay .pjc-inline-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                justify-content: flex-end;
                flex: 0 0 auto;
            }

            #projudi-wide-panel-overlay .pjc-inline-controls--compact {
                gap: 6px;
            }

            #projudi-wide-panel-overlay .pjc-inline-controls span {
                color: #334155;
                font-size: 13px;
            }

            #projudi-wide-panel-overlay .pjc-input,
            #projudi-wide-panel-overlay .pjc-select,
            #projudi-wide-panel-overlay .pjc-text {
                width: 100%;
                padding: 7px 9px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #ffffff;
                color: #0f172a;
                font: inherit;
            }

            #projudi-wide-panel-overlay .pjc-input--number {
                width: 72px;
                text-align: right;
            }

            #projudi-wide-panel-overlay .pjc-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 10px;
            }

            #projudi-wide-panel-overlay .pjc-checkline {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: #334155;
                font-size: 13px;
                font-weight: 500;
            }

            #projudi-wide-panel-overlay .pjc-checkline input[type="checkbox"] {
                width: 16px;
                height: 16px;
                margin: 0;
            }

            #projudi-wide-panel-overlay .pjc-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 10px;
            }

            #projudi-wide-panel-overlay .pjc-btn-secondary,
            #projudi-wide-panel-overlay .pjc-btn-danger {
                min-width: 130px;
                padding: 7px 11px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
            }

            #projudi-wide-panel-overlay .pjc-btn-secondary {
                border: 1px solid #cbd5e1;
                background: #ffffff;
                color: #1e293b;
            }

            #projudi-wide-panel-overlay .pjc-btn-danger {
                border: 1px solid #fecaca;
                background: #fff5f5;
                color: #b42318;
            }

            #projudi-wide-panel-overlay .pjc-card-action {
                min-width: 122px;
                padding: 7px 11px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #ffffff;
                color: #1e293b;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
            }

            #projudi-wide-panel-overlay .pjc-card-action:disabled {
                opacity: .5;
                cursor: default;
            }

            #projudi-wide-panel-overlay .pjc-note {
                margin: 0;
                color: #64748b;
                font-size: 12px;
                line-height: 1.45;
            }

            #projudi-wide-panel-overlay .pjc-meta {
                color: #94a3b8;
                font-size: 11px;
            }

            @media (max-width: 700px) {
                #projudi-wide-panel-overlay #pj-panel-body {
                    padding: 12px !important;
                }
                #projudi-wide-panel-overlay #pj-panel-footer {
                    padding: 10px 12px !important;
                }
                #projudi-wide-panel-overlay .pjc-card {
                    flex-direction: column;
                }
                #projudi-wide-panel-overlay .pjc-inline-controls {
                    width: 100%;
                    justify-content: flex-start;
                }
                #projudi-wide-panel-overlay .pjc-input--number {
                    width: 84px;
                }
            }
        `;

        panel.innerHTML = `
            <div id="pj-panel-header" style="padding:14px 16px; background:linear-gradient(135deg,#0f3e75,#1f5ca4); color:#fff;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div>
                        <div style="font-size:16px; font-weight:700; line-height:1.2;">Customizações</div>
                        <div style="font-size:12px; opacity:.9; margin-top:2px;">Configurações visuais e de abertura de arquivos</div>
                    </div>
                    <button id="pj-close" style="border:0; background:rgba(255,255,255,.2); color:#fff; width:28px; height:28px; border-radius:999px; cursor:pointer; font-size:14px; font-weight:500; line-height:1.2;">×</button>
                </div>
            </div>
            <div id="pj-panel-body">
                <div class="pjc-body">
                    <section class="pjc-section">
                        <div class="pjc-section-title">Geral</div>
                        <label class="pjc-card pjc-card--soft">
                            <div class="pjc-card-body">
                                <p class="pjc-card-title">Ativar script</p>
                                <p class="pjc-card-desc">Liga e desliga todos os ajustes sem precisar mexer nas configurações da extensão.</p>
                            </div>
                            <input type="checkbox" id="pj-enabled" class="pjc-card-check">
                        </label>
                    </section>

                    <section class="pjc-section">
                        <div class="pjc-section-title">Navegação e Cabeçalho</div>
                        <div class="pjc-stack">
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Remover barras de rolagem do iframe</p>
                                    <p class="pjc-card-desc">Esconde as barras visuais do iframe principal mantendo a rolagem ativa.</p>
                                </div>
                                <input type="checkbox" id="pj-remove-scrollbar" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Ocultar cabeçalho automaticamente</p>
                                    <p class="pjc-card-desc">Esconde o topo ao passar o mouse na área do processo.</p>
                                </div>
                                <input type="checkbox" id="pj-auto-hide" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Ajuste automático da altura</p>
                                    <p class="pjc-card-desc">Calcula a altura ideal do iframe para usar melhor a tela.</p>
                                </div>
                                <input type="checkbox" id="pj-iframe-height" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Ocultar relógio</p>
                                    <p class="pjc-card-desc">Esconde apenas o cronômetro do topo.</p>
                                </div>
                                <input type="checkbox" id="pj-hide-clock" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Ocultar ícones utilitários</p>
                                    <p class="pjc-card-desc">Esconde os ícones do topo, como fonte, ajuda, voltar e sair.</p>
                                </div>
                                <input type="checkbox" id="pj-hide-icons" class="pjc-card-check">
                            </label>
                        </div>
                    </section>

                    <section class="pjc-section">
                        <div class="pjc-section-title">Layout e Aparência</div>
                        <div class="pjc-stack">
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Largura da página</p>
                                    <p class="pjc-card-desc">Define a largura do conteúdo e do topo entre 60% e 100%.</p>
                                </div>
                                <div class="pjc-inline-controls pjc-inline-controls--compact">
                                    <input type="number" id="pj-content-width" min="60" max="100" step="1" class="pjc-input pjc-input--number">
                                    <span>%</span>
                                    <input type="checkbox" id="pj-enable-width" title="Ativar ajuste de largura" class="pjc-card-check">
                                </div>
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Centralizar conteúdo</p>
                                    <p class="pjc-card-desc">Ativado por padrão para manter o layout centralizado.</p>
                                </div>
                                <input type="checkbox" id="pj-center-content" class="pjc-card-check" disabled>
                            </label>
                            <label id="pj-row-standalone" class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Aplicar em páginas diretas</p>
                                    <p class="pjc-card-desc">Aplica ajustes também em links abertos fora do iframe.</p>
                                </div>
                                <input type="checkbox" id="pj-standalone" class="pjc-card-check">
                            </label>
                            <label id="pj-row-side-bg" class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Fundo lateral</p>
                                    <p class="pjc-card-desc">Cor das áreas laterais quando a largura for menor que 100%.</p>
                                </div>
                                <div class="pjc-inline-controls">
                                    <select id="pj-side-bg" class="pjc-select">
                                        <option value="original">Original</option>
                                        <option value="white">Branco</option>
                                        <option value="light">Cinza claro</option>
                                    </select>
                                    <input type="checkbox" id="pj-enable-side-bg" title="Ativar ajuste de fundo lateral" class="pjc-card-check">
                                </div>
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Modo compacto</p>
                                    <p class="pjc-card-desc">Reduz espaços verticais em telas e tabelas.</p>
                                </div>
                                <input type="checkbox" id="pj-compact-mode" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Tamanho da fonte</p>
                                    <p class="pjc-card-desc">Ajusta a escala do texto do conteúdo.</p>
                                </div>
                                <div class="pjc-inline-controls">
                                    <select id="pj-font-scale" class="pjc-select">
                                        <option value="90">90%</option>
                                        <option value="100">100%</option>
                                        <option value="110">110%</option>
                                    </select>
                                    <input type="checkbox" id="pj-enable-font-scale" title="Ativar ajuste de fonte" class="pjc-card-check">
                                </div>
                            </label>
                        </div>
                    </section>

                    <section class="pjc-section">
                        <div class="pjc-section-title">Arquivos do Processo</div>
                        <div class="pjc-stack">
                            <div class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Destacar movimentações</p>
                                    <p class="pjc-card-desc">Aplica cores e formatação às movimentações do processo. As opções avançadas ficam em um pop-up próprio.</p>
                                </div>
                                <div class="pjc-inline-controls">
                                    <button type="button" id="pj-mov-settings" class="pjc-card-action">Opções</button>
                                    <input type="checkbox" id="pj-enable-movimentacoes" class="pjc-card-check">
                                </div>
                            </div>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Abrir arquivos do processo em pop-up</p>
                                    <p class="pjc-card-desc">Nos eventos do processo, abre arquivos na mesma aba com opção de minimizar e fechar.</p>
                                </div>
                                <input type="checkbox" id="pj-process-popup" class="pjc-card-check">
                            </label>
                            <label class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Botão “Gerar espelho do processo”</p>
                                    <p class="pjc-card-desc">Mostra o botão ao lado do PDF padrão para gerar capa e movimentações via script.</p>
                                </div>
                                <input type="checkbox" id="pj-process-mirror-pdf" class="pjc-card-check">
                            </label>
                            <label id="pj-row-popup-size" class="pjc-card">
                                <div class="pjc-card-body">
                                    <p class="pjc-card-title">Tamanho do pop-up</p>
                                    <p class="pjc-card-desc">Define a largura e altura do pop-up entre 60% e 100% da janela.</p>
                                </div>
                                <div class="pjc-inline-controls pjc-inline-controls--compact">
                                    <input type="number" id="pj-popup-size" min="60" max="100" step="1" class="pjc-input pjc-input--number">
                                    <span>%</span>
                                </div>
                            </label>
                        </div>
                        <p class="pjc-note">As alterações são salvas e aplicadas imediatamente.</p>
                    </section>

                    <section class="pjc-section">
                        <div class="pjc-section-title">Backup remoto</div>
                        <div class="pjc-card pjc-card--soft">
                            <div class="pjc-card-body">
                                <div class="pjc-stack">
                                    <label class="pjc-card pjc-card--soft">
                                        <div class="pjc-card-body">
                                            <p class="pjc-card-title">Ativar backup por Gist no GitHub</p>
                                            <p class="pjc-card-desc">Usa um arquivo deste script dentro do seu Gist único de backups.</p>
                                        </div>
                                        <input type="checkbox" id="pj-backup-enabled" class="pjc-card-check">
                                    </label>
                                    <div class="pjc-grid">
                                        <input type="text" id="pj-backup-gist-id" placeholder="Gist ID" class="pjc-input">
                                        <input type="password" id="pj-backup-token" placeholder="Token do GitHub" class="pjc-input">
                                        <input type="text" id="pj-backup-file-name" placeholder="Nome do arquivo" class="pjc-input">
                                    </div>
                                    <label class="pjc-checkline">
                                        <input type="checkbox" id="pj-backup-auto">
                                        <span>Backup automático</span>
                                    </label>
                                    <div class="pjc-actions">
                                        <button id="pj-backup-send" type="button" class="pjc-btn-secondary">Enviar backup</button>
                                        <button id="pj-backup-restore" type="button" class="pjc-btn-secondary">Restaurar backup</button>
                                        <button id="pj-backup-clear" type="button" class="pjc-btn-danger">Limpar backup</button>
                                    </div>
                                    <div id="pj-backup-status" class="pjc-note"></div>
                                    <div id="pj-backup-last" class="pjc-meta">${formatLastBackupLabel(backupSettings.lastBackupAt)}</div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
            <div id="pj-panel-footer" style="display:flex; gap:8px; justify-content:flex-end; padding:12px 16px; border-top:1px solid #dbe3ef; background:#f8fafc;">
                <button id="pj-reset" style="padding:7px 11px; min-width:86px; border:1px solid #cbd5e1; background:#fff; border-radius:8px; cursor:pointer;">Padrão</button>
                <button id="pj-cancel" style="padding:7px 11px; min-width:86px; border:1px solid #cbd5e1; background:#fff; border-radius:8px; cursor:pointer;">Fechar</button>
                <button id="pj-save" style="padding:7px 11px; min-width:86px; background:#0f3e75; color:#fff; border:0; border-radius:8px; cursor:pointer; font-weight:600;">Salvar</button>
            </div>
        `;

        overlay.appendChild(scopedStyle);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            panel.style.transform = "translateY(0) scale(1)";
            panel.style.opacity = "1";
        });

        const autoHide = panel.querySelector("#pj-auto-hide");
        const iframeH = panel.querySelector("#pj-iframe-height");
        const enableWidth = panel.querySelector("#pj-enable-width");
        const contentW = panel.querySelector("#pj-content-width");
        const enabled = panel.querySelector("#pj-enabled");
        const centerContent = panel.querySelector("#pj-center-content");
        const compactMode = panel.querySelector("#pj-compact-mode");
        const enableFontScale = panel.querySelector("#pj-enable-font-scale");
        const fontScale = panel.querySelector("#pj-font-scale");
        const enableSideBg = panel.querySelector("#pj-enable-side-bg");
        const sideBg = panel.querySelector("#pj-side-bg");
        const hideClock = panel.querySelector("#pj-hide-clock");
        const hideIcons = panel.querySelector("#pj-hide-icons");
        const removeScrollbar = panel.querySelector("#pj-remove-scrollbar");
        const enableMovimentacoes = panel.querySelector("#pj-enable-movimentacoes");
        const movSettings = panel.querySelector("#pj-mov-settings");
        const standalone = panel.querySelector("#pj-standalone");
        const processPopup = panel.querySelector("#pj-process-popup");
        const processMirrorPdf = panel.querySelector("#pj-process-mirror-pdf");
        const popupSize = panel.querySelector("#pj-popup-size");
        const rowSideBg = panel.querySelector("#pj-row-side-bg");
        const rowStandalone = panel.querySelector("#pj-row-standalone");
        const rowPopupSize = panel.querySelector("#pj-row-popup-size");
        const backupEnabled = panel.querySelector("#pj-backup-enabled");
        const backupGistId = panel.querySelector("#pj-backup-gist-id");
        const backupToken = panel.querySelector("#pj-backup-token");
        const backupFileName = panel.querySelector("#pj-backup-file-name");
        const backupAuto = panel.querySelector("#pj-backup-auto");
        const backupSend = panel.querySelector("#pj-backup-send");
        const backupRestore = panel.querySelector("#pj-backup-restore");
        const backupClear = panel.querySelector("#pj-backup-clear");
        const backupStatus = panel.querySelector("#pj-backup-status");
        const backupLast = panel.querySelector("#pj-backup-last");
        const hasBackupUi = [
            backupEnabled,
            backupGistId,
            backupToken,
            backupFileName,
            backupAuto,
            backupSend,
            backupRestore,
            backupClear,
            backupStatus,
            backupLast
        ].every(Boolean);

        enabled.checked = settings.enabled !== false;
        autoHide.checked = !!settings.autoHideHeader;
        iframeH.checked = !!settings.enableIframeAutoHeight;
        enableWidth.checked = !!settings.enableWidthAdjustments;
        contentW.value = String(sanitizeWidthPercent(settings.contentWidthPercent));
        centerContent.checked = true;
        compactMode.checked = !!settings.compactMode;
        enableFontScale.checked = !!settings.fontScaleEnabled;
        fontScale.value = String(sanitizeFontScale(settings.fontScalePercent));
        enableSideBg.checked = !!settings.sideBackgroundEnabled;
        sideBg.value = sanitizeSideBackground(settings.sideBackground);
        hideClock.checked = !!settings.hideClock;
        hideIcons.checked = !!settings.hideHeaderIcons;
        removeScrollbar.checked = !!settings.enableRemoveScrollbar;
        enableMovimentacoes.checked = !!settings.enableMovimentacoes;
        standalone.checked = !!settings.applyToStandalonePages;
        processPopup.checked = !!settings.openProcessFilesInPopup;
        processMirrorPdf.checked = settings.enableProcessMirrorPdf !== false;
        popupSize.value = String(sanitizePopupSize(settings.popupSizePercent));
        if (hasBackupUi) {
            backupEnabled.checked = backupSettings.enabled;
            backupGistId.value = backupSettings.gistId;
            backupToken.value = backupSettings.token;
            backupFileName.value = backupSettings.fileName;
            backupAuto.checked = backupSettings.autoBackupOnSave;
        }

        const syncPanelStates = () => {
            contentW.disabled = !enableWidth.checked;
            fontScale.disabled = !enableFontScale.checked;
            sideBg.disabled = !enableSideBg.checked;
            standalone.disabled = !enableWidth.checked;
            popupSize.disabled = !processPopup.checked;
            rowSideBg.style.display = enableWidth.checked ? "flex" : "none";
            rowStandalone.style.display = enableWidth.checked ? "flex" : "none";
            rowPopupSize.style.display = processPopup.checked ? "flex" : "none";
            movSettings.disabled = !enabled.checked || !enableMovimentacoes.checked;
        };
        const setBackupStatus = (message, tone) => {
            if (!hasBackupUi) return;
            backupStatus.textContent = message || "";
            backupStatus.style.color = tone === "error" ? "#b42318" : tone === "ok" ? "#067647" : "#64748b";
        };
        const updateBackupLast = () => {
            if (!hasBackupUi) return;
            backupLast.textContent = formatLastBackupLabel(backupSettings.lastBackupAt);
        };
        const readBackupSettingsFromPanel = () => {
            if (!hasBackupUi) return backupSettings;
            return normalizeBackupSettings({
                enabled: backupEnabled.checked,
                gistId: backupGistId.value,
                token: backupToken.value,
                fileName: backupFileName.value,
                autoBackupOnSave: backupAuto.checked
            });
        };
        const applySettingsToForm = (nextSettings) => {
            enabled.checked = nextSettings.enabled !== false;
            autoHide.checked = !!nextSettings.autoHideHeader;
            iframeH.checked = !!nextSettings.enableIframeAutoHeight;
            enableWidth.checked = !!nextSettings.enableWidthAdjustments;
            contentW.value = String(sanitizeWidthPercent(nextSettings.contentWidthPercent));
            centerContent.checked = true;
            compactMode.checked = !!nextSettings.compactMode;
            enableFontScale.checked = !!nextSettings.fontScaleEnabled;
            fontScale.value = String(sanitizeFontScale(nextSettings.fontScalePercent));
            enableSideBg.checked = !!nextSettings.sideBackgroundEnabled;
            sideBg.value = sanitizeSideBackground(nextSettings.sideBackground);
            hideClock.checked = !!nextSettings.hideClock;
            hideIcons.checked = !!nextSettings.hideHeaderIcons;
            removeScrollbar.checked = !!nextSettings.enableRemoveScrollbar;
            enableMovimentacoes.checked = !!nextSettings.enableMovimentacoes;
            standalone.checked = !!nextSettings.applyToStandalonePages;
            processPopup.checked = !!nextSettings.openProcessFilesInPopup;
            processMirrorPdf.checked = nextSettings.enableProcessMirrorPdf !== false;
            popupSize.value = String(sanitizePopupSize(nextSettings.popupSizePercent));
            syncPanelStates();
        };
        const getPanelSettingsPayload = () => {
            const widthPercent = sanitizeWidthPercent(contentW.value);
            const popupPercent = sanitizePopupSize(popupSize.value);
            contentW.value = String(widthPercent);
            popupSize.value = String(popupPercent);
            return {
                enabled: enabled.checked,
                autoHideHeader: autoHide.checked,
                enableIframeAutoHeight: iframeH.checked,
                enableWidthAdjustments: enableWidth.checked,
                contentWidthPercent: widthPercent,
                headerWidthPercent: widthPercent,
                centerContent: true,
                compactMode: compactMode.checked,
                fontScaleEnabled: enableFontScale.checked,
                fontScalePercent: sanitizeFontScale(fontScale.value),
                sideBackgroundEnabled: enableSideBg.checked,
                sideBackground: sanitizeSideBackground(sideBg.value),
                hideClock: hideClock.checked,
                hideHeaderIcons: hideIcons.checked,
                enableRemoveScrollbar: removeScrollbar.checked,
                enableMovimentacoes: enableMovimentacoes.checked,
                applyToStandalonePages: enableWidth.checked && standalone.checked,
                openProcessFilesInPopup: processPopup.checked,
                popupSizePercent: popupPercent,
                enableProcessMirrorPdf: processMirrorPdf.checked
            };
        };
        const runBackupNow = async (nextSettings) => {
            const currentBackupSettings = readBackupSettingsFromPanel();
            backupSettings = saveBackupSettings(currentBackupSettings);
            setBackupStatus("Enviando backup...", "muted");
            await pushBackupToGist(backupSettings, buildBackupPayload(nextSettings));
            backupSettings = saveBackupSettings({ ...backupSettings, lastBackupAt: new Date().toISOString() });
            updateBackupLast();
            setBackupStatus("Backup enviado com sucesso.", "ok");
        };
        updateBackupLast();
        syncPanelStates();
        enableWidth.addEventListener("change", syncPanelStates);
        enableFontScale.addEventListener("change", syncPanelStates);
        enableSideBg.addEventListener("change", syncPanelStates);
        processPopup.addEventListener("change", syncPanelStates);
        enabled.addEventListener("change", syncPanelStates);
        enableMovimentacoes.addEventListener("change", syncPanelStates);
        movSettings.addEventListener("click", () => {
            if (!enabled.checked || !enableMovimentacoes.checked) return;
            saveSettings({ ...settings, ...getPanelSettingsPayload() });
            applySettingsNow();
            openMovimentacoesPanel();
        });

        const escClose = (ev) => {
            if (ev.key !== "Escape") return;
            closePanel();
        };

        const closePanel = () => {
            document.removeEventListener("keydown", escClose);
            unlockBodyScroll();
            overlay.remove();
        };

        panel.querySelector("#pj-close").addEventListener("click", closePanel);
        panel.querySelector("#pj-cancel").addEventListener("click", closePanel);

        panel.querySelector("#pj-reset").addEventListener("click", () => {
            enabled.checked = DEFAULT_SETTINGS.enabled;
            autoHide.checked = DEFAULT_SETTINGS.autoHideHeader;
            iframeH.checked = DEFAULT_SETTINGS.enableIframeAutoHeight;
            enableWidth.checked = DEFAULT_SETTINGS.enableWidthAdjustments;
            contentW.value = String(DEFAULT_SETTINGS.contentWidthPercent);
            centerContent.checked = true;
            compactMode.checked = DEFAULT_SETTINGS.compactMode;
            enableFontScale.checked = DEFAULT_SETTINGS.fontScaleEnabled;
            fontScale.value = String(DEFAULT_SETTINGS.fontScalePercent);
            enableSideBg.checked = DEFAULT_SETTINGS.sideBackgroundEnabled;
            sideBg.value = DEFAULT_SETTINGS.sideBackground;
            hideClock.checked = DEFAULT_SETTINGS.hideClock;
            hideIcons.checked = DEFAULT_SETTINGS.hideHeaderIcons;
            removeScrollbar.checked = DEFAULT_SETTINGS.enableRemoveScrollbar;
            enableMovimentacoes.checked = DEFAULT_SETTINGS.enableMovimentacoes;
            standalone.checked = DEFAULT_SETTINGS.applyToStandalonePages;
            processPopup.checked = DEFAULT_SETTINGS.openProcessFilesInPopup;
            processMirrorPdf.checked = DEFAULT_SETTINGS.enableProcessMirrorPdf;
            popupSize.value = String(DEFAULT_SETTINGS.popupSizePercent);
            syncPanelStates();
        });

        if (hasBackupUi) {
            backupSend.addEventListener("click", async () => {
                try {
                    await runBackupNow(getPanelSettingsPayload());
                } catch (error) {
                    setBackupStatus(error && error.message ? error.message : "Falha ao enviar backup.", "error");
                }
            });

            backupRestore.addEventListener("click", async () => {
                try {
                    backupSettings = saveBackupSettings(readBackupSettingsFromPanel());
                    setBackupStatus("Lendo backup...", "muted");
                    const payload = await readBackupFromGist(backupSettings);
                    const restored = applyBackupPayload(payload);
                    applySettingsToForm(restored);
                    setBackupStatus("Backup restaurado com sucesso.", "ok");
                } catch (error) {
                    setBackupStatus(error && error.message ? error.message : "Falha ao restaurar backup.", "error");
                }
            });

            backupClear.addEventListener("click", () => {
                backupSettings = saveBackupSettings(DEFAULT_BACKUP_SETTINGS);
                backupEnabled.checked = backupSettings.enabled;
                backupGistId.value = backupSettings.gistId;
                backupToken.value = backupSettings.token;
                backupFileName.value = backupSettings.fileName;
                backupAuto.checked = backupSettings.autoBackupOnSave;
                updateBackupLast();
                setBackupStatus("Configuração de backup removida.", "ok");
            });
        }

        panel.querySelector("#pj-save").addEventListener("click", async () => {
            const nextSettings = getPanelSettingsPayload();
            backupSettings = saveBackupSettings(readBackupSettingsFromPanel());
            saveSettings(nextSettings);
            applySettingsNow();
            if (backupSettings.enabled && backupSettings.autoBackupOnSave) {
                try {
                    await runBackupNow(nextSettings);
                } catch (error) {
                    setBackupStatus(error && error.message ? error.message : "Falha ao enviar backup.", "error");
                    return;
                }
            }
            closePanel();
        });

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closePanel();
        });

        document.addEventListener("keydown", escClose);
    }

    function injectTopHeaderCSS() {
        const widthEnabled = !!settings.enableWidthAdjustments;
        const widthPercent = widthEnabled ? sanitizeWidthPercent(settings.headerWidthPercent) : 100;
        const widthValue = widthPercent + "%";
        const isCentered = settings.centerContent && widthPercent < 100;
        const gutterValue = isCentered ? `calc((100% - ${widthValue}) / 2)` : "0px";
        const centeredMargins = isCentered ? "auto" : "0";
        const topPageBg =
            widthEnabled && settings.sideBackgroundEnabled && settings.sideBackground === "white"
                ? "#ffffff"
                : widthEnabled && settings.sideBackgroundEnabled && settings.sideBackground === "light"
                    ? "#f3f4f6"
                    : "";
        const hasHeaderAdjust = widthEnabled || settings.hideClock || settings.hideHeaderIcons;
        if (!hasHeaderAdjust) {
            removeStyleFromDoc(document, "projudi-top-header-style");
            return;
        }

        const widthCss = widthEnabled ? `
            :root {
                --pj-header-pad: 20px;
                --pj-content-width: ${widthValue};
                --pj-content-gutter: ${gutterValue};
            }
            ${topPageBg ? `
            body.fundo {
                background: ${topPageBg} !important;
                background-color: ${topPageBg} !important;
            }` : ""}
            #Cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                box-shadow: none !important;
            }
            #pgn_cabecalho {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
                padding-left: var(--pj-header-pad) !important;
                padding-right: var(--pj-header-pad) !important;
            }
            #img_logotj { margin-left: 0 !important; }
            #pgn_cabecalho > div[style*="float: right"] {
                white-space: nowrap !important;
                display: inline-block !important;
                float: right !important;
                max-width: 100% !important;
            }
            #pgn_cabecalho > div[style*="float: right"] > * {
                float: none !important;
                display: inline-block !important;
                vertical-align: middle !important;
            }
            #cssmenu {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box !important;
                padding-left: calc(${gutterValue} + var(--pj-header-pad)) !important;
                padding-right: calc(${gutterValue} + var(--pj-header-pad)) !important;
            }
            #cssmenu > ul,
            #cssmenu ul:first-child {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                box-sizing: border-box !important;
            }
            #menuPrinciapl.menu {
                float: none !important;
                display: block !important;
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-top: -28px !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
                padding-left: var(--pj-header-pad) !important;
                padding-right: var(--pj-header-pad) !important;
                background-color: #ccc !important;
                clear: both !important;
            }
            #menuPrinciapl.menu > ul { float: left !important; }
            #menuPrinciapl #cronometro { float: right !important; margin-right: 0 !important; }
            #cssmenu > ul > li > a,
            #cssmenu > ul > li > a i { color: #ffffff !important; }
            #cssmenu ul ul a,
            #cssmenu ul ul i,
            #cssmenu ul ul li > a { color: #2f2f2f !important; }
            #cssmenu ul ul li:hover > a,
            #cssmenu ul ul li:hover > a i { color: #0f3e75 !important; }
            body > div[style*="height:28px"][style*="background-color:#ccc"] {
                border-bottom: 1px solid #cbd5e1;
            }
        ` : "";

        const visibilityCss = `
            #cronometro {
                display: ${settings.hideClock ? "none" : "block"} !important;
            }
            #pgn_cabecalho > div[style*="float: right"] {
                display: ${settings.hideHeaderIcons ? "none" : "inline-block"} !important;
            }
        `;

        const css = `${widthCss}\n${visibilityCss}`;

        let style = document.getElementById("projudi-top-header-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "projudi-top-header-style";
            document.head.appendChild(style);
        }
        if (style.textContent !== css) style.textContent = css;
    }

    function ajustarAlturaIframe() {
        if (!settings.enabled || !settings.enableIframeAutoHeight) return;

        const iframe = document.getElementById("Principal");
        if (!iframe) return;

        const cabecalho = document.getElementById("Cabecalho");
        const barraCinza = Array.from(document.body.children).find(
            d =>
                d !== iframe &&
                d.style &&
                d.style.height === "28px" &&
                d.style.backgroundColor === "#ccc"
        );

        let offsetTop = 0;
        if (cabecalho && cabecalho.offsetHeight) offsetTop += cabecalho.offsetHeight;
        if (barraCinza && barraCinza.offsetHeight) offsetTop += barraCinza.offsetHeight;

        const h = window.innerHeight - offsetTop;
        if (h > 200) iframe.style.height = h + "px";
    }

    let headerHidden = false;
    function findHeaderGrayBar() {
        return Array.from(document.body.children).find(
            d => d && d.style && d.style.height === "28px" && d.style.backgroundColor === "#ccc"
        ) || null;
    }

    function toggleElementDisplay(el, hidden) {
        if (!el) return;
        const attr = "data-pj-prev-display";
        if (hidden) {
            if (!el.hasAttribute(attr)) el.setAttribute(attr, el.style.display || "");
            el.style.display = "none";
            return;
        }
        if (el.hasAttribute(attr)) {
            el.style.display = el.getAttribute(attr) || "";
            el.removeAttribute(attr);
        }
    }

    function getHeaderHideTargets() {
        const targets = [];
        const cab = document.getElementById("Cabecalho");
        const grayBar = findHeaderGrayBar();
        const menu = document.getElementById("cssmenu");

        if (cab) targets.push(cab);
        if (grayBar) targets.push(grayBar);
        if (menu && cab && !cab.contains(menu)) {
            targets.push(menu.closest("div") || menu);
        }

        return targets.filter(Boolean);
    }

    function setHeaderHidden(hidden) {
        if (!settings.enabled) hidden = false;
        if (headerHidden === hidden) {
            updateHeaderRevealZone();
            return;
        }
        headerHidden = hidden;
        const targets = getHeaderHideTargets();
        if (!targets.length) return;
        targets.forEach(el => toggleElementDisplay(el, hidden));
        updateHeaderRevealZone();
        setTimeout(() => {
            if (!hidden && settings.enabled) injectTopHeaderCSS();
            ajustarAlturaIframe();
        }, 20);
    }

    function setupHeaderAutoHide() {
        const iframe = document.getElementById("Principal");
        if (!settings.enabled || !settings.autoHideHeader) {
            if (mouseMoveListenerBound) {
                document.removeEventListener("mousemove", onDocumentMouseMove, { passive: true });
                mouseMoveListenerBound = false;
            }
            if (boundAutoHideIframeEl) {
                boundAutoHideIframeEl.removeEventListener("mouseenter", onIframeMouseEnter);
                boundAutoHideIframeEl = null;
            }
            return;
        }
        if (!mouseMoveListenerBound) {
            document.addEventListener("mousemove", onDocumentMouseMove, { passive: true });
            mouseMoveListenerBound = true;
        }
        if (!iframe) return;

        if (boundAutoHideIframeEl && boundAutoHideIframeEl !== iframe) {
            boundAutoHideIframeEl.removeEventListener("mouseenter", onIframeMouseEnter);
            boundAutoHideIframeEl = null;
        }
        if (boundAutoHideIframeEl === iframe) return;

        iframe.addEventListener("mouseenter", onIframeMouseEnter);
        boundAutoHideIframeEl = iframe;
    }

    function ensureHeaderRevealZone() {
        if (headerRevealZone || !isTopWindow() || !document.body) return;
        const zone = document.createElement("div");
        zone.id = "projudi-header-reveal-zone";
        zone.style.cssText = [
            "position:fixed",
            "top:0",
            "left:0",
            "right:0",
            "height:10px",
            "z-index:2147483000",
            "background:transparent",
            "display:none"
        ].join(";");
        zone.addEventListener("mouseenter", () => {
            if (!settings.enabled || !settings.autoHideHeader) return;
            setHeaderHidden(false);
        });
        document.body.appendChild(zone);
        headerRevealZone = zone;
    }

    function updateHeaderRevealZone() {
        if (!isTopWindow()) return;
        ensureHeaderRevealZone();
        if (!headerRevealZone) return;
        headerRevealZone.style.display = settings.enabled && settings.autoHideHeader && headerHidden ? "block" : "none";
    }

    function getPopupHostWindow() {
        try {
            return window.top || window;
        } catch (_) {
            return window;
        }
    }

    function getPopupHostDoc(fallbackDoc = document) {
        const hostWin = getPopupHostWindow();
        try {
            return hostWin.document || fallbackDoc;
        } catch (_) {
            return fallbackDoc;
        }
    }

    function ensurePopupHost(sourceDoc) {
        const hostWin = getPopupHostWindow();
        const hostDoc = getPopupHostDoc(sourceDoc);
        if (popupOwnerDoc && popupOwnerDoc !== hostDoc) removeProcessPopupUi();
        popupOwnerDoc = hostDoc;
        return { hostWin, hostDoc };
    }

    function updatePopupBodyScrollLock() {
        const hasVisible = [...popupWindows.values()].some(state => !state.minimized);
        if (hasVisible) {
            if (!popupUnlockBodyScroll && popupOwnerDoc) popupUnlockBodyScroll = lockBodyScroll(popupOwnerDoc);
            updatePopupBackdropVisibility();
            return;
        }
        if (popupUnlockBodyScroll) {
            try {
                popupUnlockBodyScroll();
            } catch (_) {}
            popupUnlockBodyScroll = null;
        }
        updatePopupBackdropVisibility();
    }

    function ensurePopupBackdrop(doc) {
        if (popupBackdrop && popupBackdrop.ownerDocument === doc) return popupBackdrop;
        if (popupBackdrop) {
            try {
                popupBackdrop.remove();
            } catch (_) {}
            popupBackdrop = null;
        }
        const backdrop = doc.createElement("div");
        backdrop.id = "pj-process-file-popup-backdrop";
        backdrop.style.cssText = [
            "position:fixed",
            "inset:0",
            "z-index:2147483646",
            "display:none",
            "background:rgba(15,23,42,.18)",
            "backdrop-filter:blur(8px)",
            "-webkit-backdrop-filter:blur(8px)"
        ].join(";");
        (doc.body || doc.documentElement).appendChild(backdrop);
        popupBackdrop = backdrop;
        return backdrop;
    }

    function updatePopupBackdropVisibility() {
        if (!popupOwnerDoc) return;
        const backdrop = ensurePopupBackdrop(popupOwnerDoc);
        if (!backdrop) return;
        const hasVisible = [...popupWindows.values()].some(state => !state.minimized);
        backdrop.style.display = hasVisible ? "block" : "none";
    }

    function getActivePopupState() {
        const active = popupActiveId ? popupWindows.get(popupActiveId) : null;
        if (active && !active.minimized) return active;
        const values = Array.from(popupWindows.values()).reverse();
        return values.find(state => !state.minimized) || null;
    }

    function tryPrintPopupContent(state) {
        if (!state || !state.contentEl) return false;
        const tag = (state.contentEl.tagName || "").toUpperCase();
        if (tag === "IFRAME") {
            try {
                const w = state.contentEl.contentWindow;
                if (!w || typeof w.print !== "function") return false;
                w.focus();
                w.print();
                return true;
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    function refreshPopupViewportAfterRestore(state) {
        if (!state || !state.panel) return;
        const panel = state.panel;
        const contentEl = state.contentEl;
        const prevTransform = panel.style.transform;
        panel.style.transform = "translateZ(0)";
        void panel.offsetHeight;

        if (contentEl && String(contentEl.tagName || "").toUpperCase() === "IFRAME") {
            const frame = contentEl;
            const prevDisplay = frame.style.display;
            frame.style.display = "none";
            void frame.offsetHeight;
            frame.style.display = prevDisplay || "block";
            frame.style.transform = "translateZ(0)";
            requestAnimationFrame(() => {
                frame.style.removeProperty("transform");
            });
        }

        requestAnimationFrame(() => {
            panel.style.transform = prevTransform || "";
            panel.style.removeProperty("will-change");
        });
    }

    function ensurePopupPrintHandler(doc) {
        if (!doc) return;
        if (popupPrintCleanup && popupOwnerDoc === doc) return;
        if (popupPrintCleanup) {
            try {
                popupPrintCleanup();
            } catch (_) {}
            popupPrintCleanup = null;
        }
        const onKeyDown = (event) => {
            const key = String(event.key || "").toLowerCase();
            if (!(event.ctrlKey || event.metaKey) || key !== "p") return;
            const state = getActivePopupState();
            if (!state) return;
            if (!tryPrintPopupContent(state)) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        };
        doc.addEventListener("keydown", onKeyDown, true);
        popupPrintCleanup = () => {
            try {
                doc.removeEventListener("keydown", onKeyDown, true);
            } catch (_) {}
        };
    }

    function updatePopupDockVisibility() {
        if (!popupDock) return;
        const minimized = [...popupWindows.values()].filter(state => state.minimized);
        const hasMinimized = minimized.length > 0;
        popupDock.style.display = hasMinimized ? "block" : "none";
        if (!hasMinimized) {
            if (popupDockMenu) popupDockMenu.style.display = "none";
            return;
        }
        if (popupDockToggle) popupDockToggle.textContent = `Arquivos (${minimized.length})`;
        renderPopupDockMenu();
    }

    function renderPopupDockMenu() {
        if (!popupDockMenu) return;
        popupDockMenu.innerHTML = "";
        const minimized = Array.from(popupWindows.values()).filter(state => state.minimized).reverse();
        minimized.forEach((state) => {
            const row = popupDockMenu.ownerDocument.createElement("div");
            row.style.cssText = "display:flex; align-items:center; gap:8px;";

            const openBtn = popupDockMenu.ownerDocument.createElement("button");
            openBtn.type = "button";
            openBtn.textContent = state.dockTitle || state.title || "Arquivo";
            openBtn.title = state.title || state.dockTitle || "Arquivo";
            openBtn.style.cssText = [
                "flex:1",
                "height:30px",
                "padding:0 10px",
                "border:1px solid #cbd5e1",
                "border-radius:8px",
                "background:#fff",
                "color:#0f172a",
                "font:500 12px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif",
                "text-align:left",
                "white-space:nowrap",
                "overflow:hidden",
                "text-overflow:ellipsis",
                "cursor:pointer"
            ].join(";");
            openBtn.addEventListener("click", () => {
                state.restore();
                if (popupDockMenu) popupDockMenu.style.display = "none";
            });

            const closeBtn = popupDockMenu.ownerDocument.createElement("button");
            closeBtn.type = "button";
            closeBtn.textContent = "×";
            closeBtn.title = "Fechar arquivo";
            closeBtn.style.cssText = "width:30px; height:30px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#334155; cursor:pointer;";
            closeBtn.addEventListener("click", () => state.close());

            row.appendChild(openBtn);
            row.appendChild(closeBtn);
            popupDockMenu.appendChild(row);
        });
    }

    function ensurePopupDock(doc) {
        if (popupDock && popupDock.ownerDocument === doc) return popupDock;
        if (popupDock) {
            try {
                popupDock.remove();
            } catch (_) {}
            popupDock = null;
        }
        const dock = doc.createElement("div");
        dock.id = "pj-process-file-popup-dock";
        dock.style.cssText = [
            "position:fixed",
            "right:14px",
            "bottom:14px",
            "z-index:2147483647",
            "display:none",
            "width:min(200px, calc(100vw - 24px))"
        ].join(";");

        const toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.textContent = "Arquivos (0)";
        toggle.style.cssText = [
            "width:100%",
            "height:30px",
            "padding:0 10px",
            "border:1px solid rgba(15,62,117,.25)",
            "border-radius:8px",
            "background:linear-gradient(180deg,#0f3e75,#0d3360)",
            "color:#fff",
            "font:600 12px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif",
            "cursor:pointer",
            "box-shadow:0 6px 14px rgba(2,6,23,.22)"
        ].join(";");

        const menu = doc.createElement("div");
        menu.style.cssText = [
            "display:none",
            "margin-top:8px",
            "padding:8px",
            "border:1px solid #dbe3ef",
            "border-radius:10px",
            "background:#f8fafc",
            "box-shadow:0 8px 20px rgba(2,6,23,.18)",
            "max-height:min(45vh, 360px)",
            "overflow:auto",
            "flex-direction:column",
            "gap:8px"
        ].join(";");

        toggle.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!popupDockMenu) return;
            popupDockMenu.style.display = popupDockMenu.style.display === "flex" ? "none" : "flex";
        });

        doc.addEventListener("mousedown", (event) => {
            if (!popupDock || !popupDockMenu) return;
            if (!popupDock.contains(event.target)) popupDockMenu.style.display = "none";
        }, true);

        dock.appendChild(toggle);
        dock.appendChild(menu);
        (doc.body || doc.documentElement).appendChild(dock);
        popupDock = dock;
        popupDockToggle = toggle;
        popupDockMenu = menu;
        return dock;
    }

    function removeProcessPopupUi() {
        if (popupHookCleanup) {
            popupHookCleanup();
            popupHookCleanup = null;
        }
        popupHookedDoc = null;
        popupWindows.forEach((entry) => {
            try {
                entry.panel.remove();
            } catch (_) {}
        });
        popupWindows.clear();
        if (popupDock) {
            try {
                popupDock.remove();
            } catch (_) {}
            popupDock = null;
        }
        if (popupBackdrop) {
            try {
                popupBackdrop.remove();
            } catch (_) {}
            popupBackdrop = null;
        }
        popupDockToggle = null;
        popupDockMenu = null;
        if (popupUnlockBodyScroll) {
            try {
                popupUnlockBodyScroll();
            } catch (_) {}
            popupUnlockBodyScroll = null;
        }
        if (popupPrintCleanup) {
            try {
                popupPrintCleanup();
            } catch (_) {}
            popupPrintCleanup = null;
        }
        popupActiveId = null;
        popupOwnerDoc = null;
    }

    function getPopupFileUrl(anchor, doc) {
        if (!anchor || !doc) return "";
        const onclick = String(anchor.getAttribute("onclick") || "");
        if (/buscarArquivosMovimentacaoJSON/i.test(onclick)) return "";

        const hrefAttr = String(anchor.getAttribute("href") || "").trim();
        if (/^javascript:\s*buscarArquivosMovimentacaoJSON/i.test(hrefAttr)) return "";

        const openMatch = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
        const raw = openMatch ? openMatch[1] : hrefAttr;
        if (!raw || raw === "#" || /^javascript:\s*void/i.test(raw)) return "";

        try {
            return new URL(raw, doc.location.href).href;
        } catch (_) {
            return "";
        }
    }

    function shouldHandleProcessFileLink(anchor, doc) {
        if (!anchor || !doc) return false;
        if (!settings.enabled || !settings.openProcessFilesInPopup) return false;
        if (!doc.getElementById("TabelaArquivos")) return false;
        if (!anchor.closest("#TabelaArquivos")) return false;

        const url = getPopupFileUrl(anchor, doc);
        if (!url) return false;

        const hrefLower = url.toLowerCase();
        if (anchor.target === "_blank") return true;
        if (/id_movimentacaoarquivo=|movimentacaoarquivo|pdfservico|download|arquivo/.test(hrefLower)) return true;
        if (/\.(pdf|mp4|webm|ogg|html?|txt|png|jpe?g|gif|docx?|xlsx?|pptx?)(\?|#|$)/.test(hrefLower)) return true;
        return !!anchor.closest("td.colunaMinima");
    }

    function buildPopupContent(url, doc) {
        const lower = String(url || "").toLowerCase();
        if (/\.(mp4|webm|ogg)(\?|#|$)/.test(lower)) {
            const video = doc.createElement("video");
            video.controls = true;
            video.autoplay = false;
            video.preload = "metadata";
            video.src = url;
            video.style.cssText = "width:100%; height:100%; background:#000;";
            return video;
        }
        const frame = doc.createElement("iframe");
        frame.src = url;
        frame.style.cssText = "display:block; width:100%; height:100%; min-height:100%; border:0; background:#fff;";
        frame.setAttribute("allow", "autoplay; fullscreen");
        return frame;
    }

    function getFilenameFromUrl(url) {
        try {
            const u = new URL(url);
            const pathName = decodeURIComponent(u.pathname || "");
            const fromPath = pathName.split("/").filter(Boolean).pop() || "";
            if (fromPath && /\.[a-z0-9]{2,6}$/i.test(fromPath)) return fromPath;
            const params = u.searchParams;
            const keys = ["nomearquivo", "nome_arquivo", "filename", "file", "arquivo", "nome"];
            for (const key of keys) {
                const value = params.get(key);
                if (value && String(value).trim()) return String(value).trim();
            }
        } catch (_) {}
        return "";
    }

    function getMovementNumberFromRow(row) {
        if (!row || !row.querySelector) return "";
        const firstCell = row.querySelector("td.colunaMinima, td");
        if (!firstCell) return "";
        const raw = String(firstCell.textContent || "").replace(/\s+/g, " ").trim();
        if (!raw) return "";
        const match = raw.match(/\d+/);
        return match ? match[0] : "";
    }

    function getMovementLabel(anchor) {
        if (!anchor || !anchor.closest) return "";
        let row = anchor.closest("tr");
        while (row) {
            if (row.matches && row.matches("tr[movi_codigo]")) {
                const number = getMovementNumberFromRow(row);
                if (number) return `Mov. ${number}`;
            }
            row = row.previousElementSibling;
        }

        const nestedHost = anchor.closest("td[id^='pai_']");
        if (!nestedHost) return "";
        const holderRow = nestedHost.closest("tr[id^='linha_']");
        if (!holderRow) return "";
        let prev = holderRow.previousElementSibling;
        while (prev) {
            if (prev.matches && prev.matches("tr[movi_codigo]")) {
                const number = getMovementNumberFromRow(prev);
                if (number) return `Mov. ${number}`;
                break;
            }
            prev = prev.previousElementSibling;
        }
        return "";
    }

    function getFileOrderLabel(anchor) {
        const parseOrder = (value) => {
            const raw = String(value || "")
                .replace(/\u00A0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            if (!raw) return "";
            if (/[:/]/.test(raw)) return "";
            const exact = raw.match(/^(\d{1,4})$/);
            if (exact) return exact[1];
            const prefixed = raw.match(/^(\d{1,4})\s*[-–.)]?\s*$/);
            if (prefixed) return prefixed[1];
            return "";
        };

        if (anchor && anchor.closest) {
            const li = anchor.closest("li");
            if (li) {
                const blocks = Array.from(li.querySelectorAll("div, span"));
                for (let i = 0; i < blocks.length; i += 1) {
                    const el = blocks[i];
                    const hint = `${String(el.getAttribute("title") || "")} ${String(el.getAttribute("alt") || "")}`.toLowerCase();
                    if (hint && !/arquiv/.test(hint)) continue;
                    const number = parseOrder(el.textContent);
                    if (number) return `Arq. ${number}`;
                }
            }
        }

        const row = anchor && anchor.closest ? anchor.closest("tr") : null;
        if (!row) return "";
        const anchorCell = anchor.closest ? anchor.closest("td") : null;
        const cells = Array.from(row.children).filter((el) => (el.tagName || "").toUpperCase() === "TD");
        if (!cells.length) return "";
        const anchorCellIndex = anchorCell ? cells.indexOf(anchorCell) : -1;
        const scanLimit = anchorCellIndex > 0 ? anchorCellIndex : cells.length;
        const scope = cells.slice(0, scanLimit);
        const ordered = [
            ...scope.filter((cell) => cell.classList && cell.classList.contains("colunaMinima")),
            ...scope.filter((cell) => !(cell.classList && cell.classList.contains("colunaMinima")))
        ];

        for (let i = 0; i < ordered.length; i += 1) {
            const cell = ordered[i];
            const number = parseOrder(cell.textContent);
            if (number) return `Arq. ${number}`;
        }
        return "";
    }

    function getFilenameFromTooltip(rawTitle) {
        const full = String(rawTitle || "").trim();
        if (!full) return "";
        const lines = full.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        for (const line of lines) {
            const m = line.match(/([a-z0-9._-]+\.[a-z0-9]{2,8})/i);
            if (m && m[1]) return m[1];
        }
        const first = lines[0] || "";
        return first;
    }

    function getPopupTitleMeta(anchor, url) {
        const movement = getMovementLabel(anchor);
        const fileOrder = getFileOrderLabel(anchor);
        const prefix = [movement, fileOrder].filter(Boolean).join(" • ");
        const titleAttr = String(anchor.getAttribute("title") || "").trim();
        const fromTooltip = getFilenameFromTooltip(titleAttr);
        if (fromTooltip) return { fullTitle: prefix ? `${prefix} • ${fromTooltip}` : fromTooltip, dockTitle: prefix || "Arquivo" };
        const fromUrl = getFilenameFromUrl(url);
        if (fromUrl) return { fullTitle: prefix ? `${prefix} • ${fromUrl}` : fromUrl, dockTitle: prefix || "Arquivo" };
        if (titleAttr && /\.[a-z0-9]{2,6}$/i.test(titleAttr)) return { fullTitle: prefix ? `${prefix} • ${titleAttr}` : titleAttr, dockTitle: prefix || "Arquivo" };
        const text = String(anchor.textContent || "").trim();
        if (text) return { fullTitle: prefix ? `${prefix} • ${text}` : text, dockTitle: prefix || "Arquivo" };
        return { fullTitle: prefix ? `${prefix} • Arquivo do processo` : "Arquivo do processo", dockTitle: prefix || "Arquivo" };
    }

    function createPopupWindow(doc, url, title, dockTitle) {
        popupWindowCounter += 1;
        const popupId = `pj-popup-${popupWindowCounter}`;
        const popupSize = sanitizePopupSize(settings.popupSizePercent);

        const panel = doc.createElement("div");
        panel.id = popupId;
        panel.style.cssText = [
            "position:fixed",
            "top:50%",
            "left:50%",
            "transform:translate(-50%,-50%)",
            `width:min(${popupSize}vw, calc(100vw - 20px))`,
            `height:min(${popupSize}vh, calc(100vh - 20px))`,
            "z-index:2147483647",
            "display:flex",
            "flex-direction:column",
            "background:#fff",
            "border:1px solid #dbe3ef",
            "border-radius:12px",
            "box-shadow:0 24px 70px rgba(2,6,23,.30)",
            "overflow:hidden",
            "overscroll-behavior:contain"
        ].join(";");

        const head = doc.createElement("div");
        head.style.cssText = [
            "height:42px",
            "padding:0 10px",
            "display:flex",
            "align-items:center",
            "justify-content:space-between",
            "gap:10px",
            "background:linear-gradient(135deg,#0f3e75,#1f5ca4)",
            "color:#fff",
            "font:500 13px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif"
        ].join(";");

        const titleEl = doc.createElement("div");
        titleEl.style.cssText = [
            "min-width:0",
            "flex:1",
            "line-height:1.2",
            "white-space:nowrap",
            "overflow:hidden",
            "text-overflow:ellipsis"
        ].join(";");
        titleEl.textContent = title || "Arquivo do processo";
        titleEl.title = title || "Arquivo do processo";

        const actions = doc.createElement("div");
        actions.style.cssText = "display:flex; gap:8px; align-items:center; flex:none;";

        const minBtn = doc.createElement("button");
        minBtn.type = "button";
        minBtn.textContent = "—";
        minBtn.style.cssText = "width:28px; height:28px; border:0; border-radius:999px; background:rgba(255,255,255,.2); color:#fff; cursor:pointer;";

        const closeBtn = doc.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "×";
        closeBtn.style.cssText = "width:28px; height:28px; border:0; border-radius:999px; background:rgba(255,255,255,.2); color:#fff; cursor:pointer;";

        actions.appendChild(minBtn);
        actions.appendChild(closeBtn);
        head.appendChild(titleEl);
        head.appendChild(actions);

        const body = doc.createElement("div");
        body.style.cssText = "flex:1; min-height:0; background:#fff; overflow:hidden; overscroll-behavior:contain;";
        const content = buildPopupContent(url, doc);
        body.appendChild(content);

        ensurePopupBackdrop(doc);
        panel.appendChild(head);
        panel.appendChild(body);
        (doc.body || doc.documentElement).appendChild(panel);

        ensurePopupDock(doc);
        ensurePopupPrintHandler(doc);

        const state = {
            id: popupId,
            title: title || "Arquivo",
            dockTitle: dockTitle || title || "Arquivo",
            url: String(url || ""),
            panel,
            contentEl: content,
            minimized: false,
            restore: null,
            close: null
        };
        popupWindows.set(popupId, state);
        popupActiveId = popupId;

        const minimize = () => {
            state.minimized = true;
            panel.style.display = "none";
            updatePopupDockVisibility();
            updatePopupBodyScrollLock();
        };

        const restore = () => {
            state.minimized = false;
            panel.style.display = "flex";
            popupActiveId = popupId;
            updatePopupDockVisibility();
            updatePopupBodyScrollLock();
            refreshPopupViewportAfterRestore(state);
        };

        const close = () => {
            try {
                panel.remove();
            } catch (_) {}
            popupWindows.delete(popupId);
            if (popupActiveId === popupId) popupActiveId = null;
            updatePopupDockVisibility();
            updatePopupBodyScrollLock();
            if (!popupWindows.size && popupDock) {
                try {
                    popupDock.remove();
                } catch (_) {}
                popupDock = null;
                popupDockToggle = null;
                popupDockMenu = null;
            }
        };

        state.restore = restore;
        state.close = close;

        minBtn.addEventListener("click", minimize);
        closeBtn.addEventListener("click", close);
        panel.addEventListener("mousedown", () => {
            popupActiveId = popupId;
        }, true);

        updatePopupDockVisibility();
        updatePopupBodyScrollLock();
    }

    function findPopupByUrlOrTitle(url, title) {
        const normalized = String(url).trim();
        const normalizedTitle = String(title || "").trim();
        if (!normalized && !normalizedTitle) return null;
        for (const state of popupWindows.values()) {
            const stateUrl = String(state.url || "").trim();
            const stateTitle = String(state.title || "").trim();
            if (normalized && stateUrl === normalized) return state;
            if (normalizedTitle && stateTitle && stateTitle === normalizedTitle) return state;
        }
        return null;
    }

    function openProcessFilePopup(url, titleMeta, sourceDoc) {
        if (!url) return;
        const normalized = String(url).trim();
        const normalizedTitle = String((titleMeta && titleMeta.fullTitle) || "").trim();
        const normalizedDockTitle = String((titleMeta && titleMeta.dockTitle) || "").trim();
        const existing = findPopupByUrlOrTitle(normalized, normalizedTitle);
        if (existing) {
            existing.restore();
            return;
        }
        const { hostDoc } = ensurePopupHost(sourceDoc || document);
        createPopupWindow(hostDoc, normalized, normalizedTitle || "Arquivo", normalizedDockTitle || normalizedTitle || "Arquivo");
    }

    function hookProcessFilePopupInDoc(doc) {
        if (!doc || popupHookedDoc === doc) return;

        if (popupHookCleanup) {
            popupHookCleanup();
            popupHookCleanup = null;
        }

        const onClickCapture = (event) => {
            if (event.defaultPrevented) return;
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const anchor = event.target && event.target.closest ? event.target.closest("a") : null;
            if (!anchor) return;
            if (!shouldHandleProcessFileLink(anchor, doc)) return;

            const url = getPopupFileUrl(anchor, doc);
            if (!url) return;

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

            const titleMeta = getPopupTitleMeta(anchor, url);
            openProcessFilePopup(url, titleMeta, doc);
        };

        doc.addEventListener("click", onClickCapture, true);
        popupHookedDoc = doc;
        popupHookCleanup = () => {
            try {
                doc.removeEventListener("click", onClickCapture, true);
            } catch (_) {}
            if (popupHookedDoc === doc) popupHookedDoc = null;
        };
    }

    function syncProcessPopupModeForDoc(doc) {
        const targetDoc = doc || document;
        const canUsePopup = settings.enabled && settings.openProcessFilesInPopup;
        const hasProcessTable = !!(targetDoc && targetDoc.getElementById && targetDoc.getElementById("TabelaArquivos"));
        if (!canUsePopup) {
            if (popupHookCleanup) popupHookCleanup();
            removeProcessPopupUi();
            return;
        }
        if (hasProcessTable) {
            hookProcessFilePopupInDoc(targetDoc);
            return;
        }
        if (isInitialUserHomeDoc(targetDoc)) {
            if (popupHookCleanup) popupHookCleanup();
            removeProcessPopupUi();
        }
    }

    function hasRelevantProcessPopupNode(nodes) {
        return Array.from(nodes || []).some(node => {
            if (!node || node.nodeType !== 1) return false;
            if (node.id === "TabelaArquivos" || node.id === "tabListaProcesso") return true;
            if (node.matches?.("#TabelaArquivos, #tabListaProcesso")) return true;
            if (node.querySelector?.("#TabelaArquivos, #tabListaProcesso")) return true;
            return false;
        });
    }

    function isInitialUserHomeDoc(doc) {
        if (!doc) return false;
        let pathname = "";
        let search = "";
        try {
            const loc = doc.location;
            pathname = (loc && loc.pathname) || "";
            search = (loc && loc.search) || "";
        } catch (_) {
            return false;
        }

        if (!/\/Usuario\b/i.test(pathname)) return false;
        const params = new URLSearchParams(search || "");
        const paginaAtual = params.get("PaginaAtual");
        return paginaAtual === "-10" || paginaAtual === "10";
    }

    function getIframeContextDoc() {
        const iframe = document.getElementById("Principal");
        if (!iframe) return null;
        try {
            return iframe.contentDocument || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Sincroniza a captura de arquivos do processo com o documento atual do iframe.
     * @returns {void}
     */
    function syncPopupModeFromIframeContext() {
        if (!isTopWindow()) return;
        const iframeDoc = getIframeContextDoc();
        if (iframeDoc) {
            bindPopupContextObserver(iframeDoc);
            syncProcessPopupModeForDoc(iframeDoc);
            return;
        }
        stopPopupContextObserver();
        syncProcessPopupModeForDoc(document);
    }

    function stopPopupContextObserver() {
        if (popupContextObserver) {
            popupContextObserver.disconnect();
            popupContextObserver = null;
        }
        popupContextObservedDoc = null;
        popupContextSyncScheduled = false;
    }

    function schedulePopupContextSync() {
        if (popupContextSyncScheduled) return;
        popupContextSyncScheduled = true;
        requestAnimationFrame(() => {
            popupContextSyncScheduled = false;
            syncPopupModeFromIframeContext();
        });
    }

    /**
     * Observa apenas mutações relevantes da área de arquivos do processo.
     * @param {Document} doc
     * @returns {void}
     */
    function bindPopupContextObserver(doc) {
        if (!isTopWindow()) return;
        if (!doc || !doc.body) {
            stopPopupContextObserver();
            return;
        }
        if (popupContextObservedDoc === doc && popupContextObserver) return;
        stopPopupContextObserver();
        popupContextObservedDoc = doc;
        popupContextObserver = new MutationObserver(mutations => {
            if (!settings.enabled || !settings.openProcessFilesInPopup) return;
            if (!mutations.some(m => hasRelevantProcessPopupNode(m.addedNodes) || hasRelevantProcessPopupNode(m.removedNodes))) return;
            schedulePopupContextSync();
        });
        popupContextObserver.observe(doc.body, { childList: true, subtree: true });
    }

    function canInjectIntoDoc(doc) {
        const html = doc.documentElement;
        const body = doc.body;
        return !(
            (html && html.hasAttribute(OPTOUT_ATTR)) ||
            (body && body.hasAttribute(OPTOUT_ATTR))
        );
    }

    /**
     * Injeta o CSS mínimo necessário para largura, tipografia e modo compacto.
     * @param {Document} doc
     * @returns {void}
     */
    function injectWidthCSS(doc) {
        if (!settings.enabled || !doc || !doc.head || !canInjectIntoDoc(doc)) return;
        const widthEnabled = !!settings.enableWidthAdjustments;
        const widthPercent = widthEnabled ? sanitizeWidthPercent(settings.contentWidthPercent) : 100;
        const widthValue = widthPercent + "%";
        const centeredMargins = settings.centerContent && widthPercent < 100 ? "auto" : "0";
        const pageBg =
            widthEnabled && settings.sideBackgroundEnabled && settings.sideBackground === "white"
                ? "#ffffff"
                : widthEnabled && settings.sideBackgroundEnabled && settings.sideBackground === "light"
                    ? "#f3f4f6"
                    : "";
        const fontScaleCss =
            settings.fontScaleEnabled && settings.fontScalePercent !== 100
                ? `body { font-size: ${settings.fontScalePercent}% !important; }`
                : "";
        const compactCss = settings.compactMode
            ? `
                table { border-spacing: 0 !important; }
                td, th {
                    padding-top: 2px !important;
                    padding-bottom: 2px !important;
                    line-height: 1.15 !important;
                }
                .Tabela td, .Tabela th {
                    padding-top: 2px !important;
                    padding-bottom: 2px !important;
                    line-height: 1.15 !important;
                }
                tr { line-height: 1.15 !important; }
                #divCorpo, .divCorpo, #Corpo, #conteudo, #conteudoPrincipal, #pgn_corpo, #Formulario, .Tela, .Corpo, .conteudo {
                    padding-top: 4px !important;
                }
                h1, h2, h3, h4, h5, h6 { margin-top: 4px !important; margin-bottom: 4px !important; }
                p { margin-top: 4px !important; margin-bottom: 4px !important; }
            `
            : "";

        const styleId = "projudi-ajuste-largura";
        const hasCssAdjust = widthEnabled || !!settings.compactMode || !!settings.fontScaleEnabled;
        if (!hasCssAdjust) {
            removeStyleFromDoc(doc, styleId);
            return;
        }
        let style = doc.getElementById(styleId);

        const css = `
            html, body {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                ${pageBg ? `background-color: ${pageBg} !important;` : ""}
            }
            ${fontScaleCss}

            #divCorpo,
            .divCorpo,
            #Corpo,
            #conteudo,
            #conteudoPrincipal,
            #pgn_corpo,
            .Tela,
            .Corpo,
            .conteudo,
            #content,
            #container,
            #principal,
            .container,
            .wrapper,
            .main,
            table[width="980"],
            table[width="1000"] {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
            }

            #Formulario,
            #divEditar,
            .divEditar,
            .VisualizaDados,
            #abas {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box !important;
            }

            table,
            .Tabela,
            .divTabela,
            .divTabela table {
                max-width: 100% !important;
            }

            body > div[style*="width:"][style*="margin"],
            body > table[style*="width:"] {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
            }

            ${compactCss}
        `;

        if (!style) {
            style = doc.createElement("style");
            style.id = styleId;
            doc.head.appendChild(style);
        }

        if (style.textContent !== css) style.textContent = css;
    }

    function isStandaloneContentPage() {
        if (!isTopWindow()) return false;
        if (!settings.applyToStandalonePages) return false;
        if (document.getElementById("Principal")) return false;

        return (
            /\/BuscaProcesso\b/i.test(window.location.pathname) ||
            /\bId_Processo=/i.test(window.location.search) ||
            !!document.querySelector(
                "#divCorpo, .divCorpo, #Corpo, #conteudo, #conteudoPrincipal, #pgn_corpo, #Formulario, .Tela, .Corpo, .conteudo"
            )
        );
    }

    function injectCSSInIframe() {
        if (!settings.enabled || !shouldManageIframeFeatures()) return;
        const iframe = document.getElementById("Principal");
        if (!iframe || !iframe.contentDocument) return;

        iframe.style.width = "100%";
        iframe.style.display = "block";

        const iframeDoc = iframe.contentDocument;
        injectWidthCSS(iframeDoc);
        syncNoScrollbarForDoc(iframeDoc);
        if (settings.enableProcessMirrorPdf) initProcessMirrorPdfFeature(iframeDoc);
        else teardownProcessMirrorPdfFeature(iframeDoc);
    }

    function retryInjectInIframe(times = 12, delay = 240) {
        if (!settings.enabled || !shouldManageIframeFeatures()) return;
        clearPendingIframeRetryTimers();
        iframeRetryRunId += 1;
        const runId = iframeRetryRunId;
        let n = 0;
        const tick = () => {
            if (runId !== iframeRetryRunId) return;
            injectCSSInIframe();
            ajustarAlturaIframe();
            n += 1;
            if (n < times) rememberTimeout(setTimeout(tick, delay));
        };
        tick();
    }

    function bindIframeLoadListener() {
        if (!shouldManageIframeFeatures()) return;
        const iframe = document.getElementById("Principal");
        if (!iframe) return;
        if (boundIframeEl && boundIframeEl !== iframe) {
            boundIframeEl.removeEventListener("load", onIframeLoad);
            boundIframeEl = null;
        }
        if (boundIframeEl !== iframe) {
            iframe.addEventListener("load", onIframeLoad);
            boundIframeEl = iframe;
        }

        retryInjectInIframe(14, 220);
    }

    function scheduleTopDomMaintenance() {
        if (topDomWorkScheduled) return;
        topDomWorkScheduled = true;
        requestAnimationFrame(() => {
            topDomWorkScheduled = false;
            safeRun("Falha ao sincronizar observers do topo.", () => {
                bindIframeLoadListener();
                setupHeaderAutoHide();
                ajustarAlturaIframe();
            });
        });
    }

    function mutationTouchesTopShell(mutations) {
        return mutations.some(mutation => {
            if (hasRelevantProcessPopupNode(mutation.addedNodes) || hasRelevantProcessPopupNode(mutation.removedNodes)) return true;
            return Array.from([mutation.target, ...mutation.addedNodes, ...mutation.removedNodes]).some(node => {
                if (!node || node.nodeType !== 1) return false;
                if (node.id === "Principal" || node.id === "Cabecalho" || node.id === "cssmenu") return true;
                if (node.matches?.("#Principal, #Cabecalho, #cssmenu")) return true;
                if (node.querySelector?.("#Principal, #Cabecalho, #cssmenu")) return true;
                return false;
            });
        });
    }

    function watchForIframeAvailability() {
        if (!shouldManageIframeFeatures()) return;
        bindIframeLoadListener();
        setupHeaderAutoHide();

        if (iframeAvailabilityObserver) iframeAvailabilityObserver.disconnect();
        iframeAvailabilityObserver = new MutationObserver(mutations => {
            if (!mutationTouchesTopShell(mutations)) return;
            scheduleTopDomMaintenance();
        });
        iframeAvailabilityObserver.observe(document.body, { childList: true, subtree: true });

        if (!document.getElementById("Principal")) {
            rememberTimeout(setTimeout(bindIframeLoadListener, 500));
            rememberTimeout(setTimeout(bindIframeLoadListener, 1600));
        }
    }

    function scheduleStandaloneRefresh() {
        if (standaloneDomWorkScheduled) return;
        standaloneDomWorkScheduled = true;
        requestAnimationFrame(() => {
            standaloneDomWorkScheduled = false;
            if (settings.enabled && isStandaloneContentPage()) injectWidthCSS(document);
        });
    }

    function hasStandaloneRelevantMutation(mutations) {
        return mutations.some(mutation => {
            return Array.from([mutation.target, ...mutation.addedNodes, ...mutation.removedNodes]).some(node => {
                if (!node || node.nodeType !== 1) return false;
                if (node.id === "Principal") return true;
                if (node.matches?.("#divCorpo, .divCorpo, #Corpo, #conteudo, #conteudoPrincipal, #pgn_corpo, #Formulario, .Tela, .Corpo, .conteudo")) return true;
                if (node.querySelector?.("#Principal, #divCorpo, .divCorpo, #Corpo, #conteudo, #conteudoPrincipal, #pgn_corpo, #Formulario, .Tela, .Corpo, .conteudo")) return true;
                return false;
            });
        });
    }

    /**
     * Mantém ativos apenas os observers necessários para os recursos atualmente habilitados.
     * @returns {void}
     */
    function syncTopObservers() {
        if (iframeAvailabilityObserver) {
            iframeAvailabilityObserver.disconnect();
            iframeAvailabilityObserver = null;
        }
        if (standaloneDomObserver) {
            standaloneDomObserver.disconnect();
            standaloneDomObserver = null;
        }

        if (!settings.enabled) {
            stopPopupContextObserver();
            return;
        }

        if (shouldManageIframeFeatures()) watchForIframeAvailability();

        if (!settings.applyToStandalonePages || document.getElementById("Principal")) return;
        standaloneDomObserver = new MutationObserver(mutations => {
            if (!hasStandaloneRelevantMutation(mutations)) return;
            scheduleStandaloneRefresh();
        });
        standaloneDomObserver.observe(document.body, { childList: true, subtree: true });
    }

    function initTop() {
        safeRun("Falha ao aplicar configurações iniciais do topo.", () => applySettingsNow());

        window.addEventListener("resize", ajustarAlturaIframe, { passive: true });
        syncTopObservers();
    }

    function initInsideFrame() {
        safeRun("Falha ao inicializar customizações dentro do iframe.", () => {
            if (settings.enabled) injectWidthCSS(document);
            syncNoScrollbarForDoc(document);
            syncProcessPopupModeForDoc(document);
        });
    }

    function normalizeText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function removeDiacritics(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function normalizeLabel(value) {
        return removeDiacritics(normalizeText(value)).toLowerCase();
    }

    function isProcessPageDoc(doc) {
        if (!doc) return false;
        return !!(
            doc.getElementById("TabelaArquivos") &&
            doc.getElementById("tabListaProcesso") &&
            doc.getElementById("span_proc_numero")
        );
    }

    function findExistingProcessPdfButton(doc) {
        if (!doc) return null;
        return (
            doc.querySelector("button[title*='Gerar PDF de Processo Completo']") ||
            doc.querySelector("button[alt*='Gerar PDF de Processo Completo']") ||
            doc.querySelector(".divBotoesDireita button .fa-file-pdf")?.closest("button") ||
            null
        );
    }

    function extractNextMeaningfulText(node) {
        if (!node) return "";
        let cursor = node.nextSibling;
        while (cursor) {
            if (cursor.nodeType === 3) {
                const txt = normalizeText(cursor.textContent);
                if (txt) return txt;
            } else if (cursor.nodeType === 1) {
                const tag = (cursor.tagName || "").toUpperCase();
                if (tag === "BR" || tag === "SCRIPT" || tag === "STYLE") {
                    cursor = cursor.nextSibling;
                    continue;
                }
                const txt = normalizeText(cursor.textContent);
                if (txt) return txt;
            }
            cursor = cursor.nextSibling;
        }
        return "";
    }

    function getFieldValueByLabel(fieldset, label) {
        if (!fieldset) return "";
        const normalizedLabel = normalizeLabel(label);
        const candidates = Array.from(fieldset.querySelectorAll("div, span, label"));
        for (const el of candidates) {
            const currentLabel = normalizeLabel(el.textContent);
            if (currentLabel !== normalizedLabel) continue;
            const value = extractNextMeaningfulText(el);
            if (value) return value;
        }
        return "";
    }

    function findFieldsetByLegend(doc, textMatch) {
        if (!doc) return null;
        const normalizedMatch = normalizeLabel(textMatch);
        const fieldsets = Array.from(doc.querySelectorAll("fieldset"));
        for (const fs of fieldsets) {
            const legend = fs.querySelector("legend");
            if (!legend) continue;
            if (normalizeLabel(legend.textContent).includes(normalizedMatch)) return fs;
        }
        return null;
    }

    function extractPartyNames(doc, poloLabel) {
        const fs = findFieldsetByLegend(doc, poloLabel);
        if (!fs) return [];
        const namesFromTitle = Array.from(
            fs.querySelectorAll('[title="Nome da Parte"], [alt="Nome da Parte"]')
        )
            .map(el => normalizeText(el.textContent))
            .filter(Boolean);

        let names = namesFromTitle;
        if (!names.length) {
            const labels = Array.from(fs.querySelectorAll("div, label"))
                .filter(el => normalizeLabel(el.textContent) === "nome");
            names = labels
                .map(label => normalizeText(extractNextMeaningfulText(label)))
                .filter(Boolean);
        }

        if (!names.length) return [];
        const seen = new Set();
        const unique = [];
        names.forEach(name => {
            if (seen.has(name)) return;
            seen.add(name);
            unique.push(name);
        });
        return unique;
    }

    function collectProcessSnapshotData(doc) {
        const processNumber = normalizeText(doc.getElementById("span_proc_numero")?.textContent || "");
        const infoFieldset = findFieldsetByLegend(doc, "Outras Informações");
        const identityContainer = doc.querySelector(".aEsquerda");
        const classe = getFieldValueByLabel(infoFieldset, "Classe");
        const assunto = getFieldValueByLabel(infoFieldset, "Assunto(s)");
        const area = normalizeText(getFieldValueByLabel(identityContainer || doc, "Área"));
        const movimentacoes = Array.from(doc.querySelectorAll("#tabListaProcesso tr[movi_codigo]"))
            .map(row => {
                const cols = row.querySelectorAll("td");
                if (!cols || cols.length < 4) return null;
                const numero = normalizeText(cols[0].textContent);
                const tipo = normalizeText(cols[1].querySelector(".filtro_tipo_movimentacao")?.textContent || "");
                const textoIntegral = normalizeText(cols[1].textContent);
                const detalhe = normalizeText(textoIntegral.replace(tipo, ""));
                const movimentacao = normalizeText([tipo, detalhe].filter(Boolean).join(" - "));
                const data = normalizeText(cols[2].textContent);
                const usuario = normalizeText(cols[3].textContent);
                if (!numero && !movimentacao && !data && !usuario) return null;
                return { numero, movimentacao, data, usuario };
            })
            .filter(Boolean);

        return {
            processNumber,
            area,
            serventia: getFieldValueByLabel(infoFieldset, "Serventia"),
            classe,
            assunto,
            valorCausa: getFieldValueByLabel(infoFieldset, "Valor da Causa"),
            fase: getFieldValueByLabel(infoFieldset, "Fase Processual"),
            distribuicao: getFieldValueByLabel(infoFieldset, "Dt. Distribuição"),
            status: getFieldValueByLabel(infoFieldset, "Status"),
            prioridade: getFieldValueByLabel(infoFieldset, "Prioridade"),
            poloAtivos: extractPartyNames(doc, "Polo Ativo"),
            poloPassivos: extractPartyNames(doc, "Polo Passivo"),
            movimentacoes
        };
    }

    function loadExternalScript(doc, src) {
        return new Promise((resolve, reject) => {
            const existing = doc.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === "true") {
                    resolve();
                    return;
                }
                existing.addEventListener("load", () => resolve(), { once: true });
                existing.addEventListener("error", () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
                return;
            }
            const script = doc.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = () => {
                script.dataset.loaded = "true";
                resolve();
            };
            script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
            (doc.head || doc.documentElement).appendChild(script);
        });
    }

    async function ensureMirrorPdfDeps(doc) {
        if (doc.defaultView?.jspdf?.jsPDF) return;
        if (mirrorPdfDepsPromise) {
            await mirrorPdfDepsPromise;
            return;
        }
        mirrorPdfDepsPromise = (async () => {
            await loadExternalScript(doc, "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
            await loadExternalScript(doc, "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js");
        })();
        try {
            await mirrorPdfDepsPromise;
        } finally {
            mirrorPdfDepsPromise = null;
        }
    }

    function isRelevantMirrorPdfMutation(mutations) {
        const selectors = "#TabelaArquivos, #tabListaProcesso, .divBotoesDireita, fieldset, #projudi-mirror-pdf-btn";
        return mutations.some((mutation) => {
            return Array.from([mutation.target, ...mutation.addedNodes, ...mutation.removedNodes]).some((node) => {
                if (!node || node.nodeType !== 1) return false;
                if (node.matches?.(selectors)) return true;
                if (node.querySelector?.(selectors)) return true;
                return false;
            });
        });
    }

    function getCardHeight(pdf, width, value, minHeight = 54) {
        const wrapped = pdf.splitTextToSize(normalizeText(value || "-"), width - 24);
        const lineHeight = 12;
        const needed = 36 + (wrapped.length * lineHeight) + 10;
        return Math.max(minHeight, needed);
    }

    function drawCoverCard(pdf, left, top, width, height, title, value) {
        const cardTitle = normalizeText(title || "-");
        const cardValue = normalizeText(value || "-");
        pdf.setDrawColor(223, 231, 243);
        pdf.setFillColor(248, 251, 255);
        pdf.roundedRect(left, top, width, height, 8, 8, "FD");
        pdf.setTextColor(70, 94, 126);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9.4);
        pdf.text(cardTitle, left + 12, top + 16);
        pdf.setTextColor(15, 23, 42);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        const wrapped = pdf.splitTextToSize(cardValue, width - 24);
        pdf.text(wrapped, left + 12, top + 33);
    }

    function drawCoverPage(pdf, data) {
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 38;
        const primary = [24, 67, 123];

        pdf.setFillColor(...primary);
        pdf.rect(0, 0, pageWidth, 120, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(25);
        pdf.text("Espelho do Processo", margin, 53);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.text(`Processo ${data.processNumber || "-"}`, margin, 75);
        pdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, 93);

        const summarySectionTop = 138;
        const summaryCardHeight = 54;
        const summaryGap = 10;
        const summarySectionHeight = 34 + (summaryCardHeight * 2) + summaryGap + 16;

        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(margin, summarySectionTop, pageWidth - margin * 2, summarySectionHeight, 10, 10, "F");
        pdf.setDrawColor(215, 223, 238);
        pdf.roundedRect(margin, summarySectionTop, pageWidth - margin * 2, summarySectionHeight, 10, 10, "S");
        pdf.setTextColor(23, 54, 95);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.text("Resumo de Identificação", margin + 14, summarySectionTop + 22);

        const summaryTop = summarySectionTop + 34;
        const summaryWidth = (pageWidth - margin * 2 - summaryGap) / 2;
        drawCoverCard(pdf, margin, summaryTop, summaryWidth, summaryCardHeight, "Área", data.area);
        drawCoverCard(pdf, margin + summaryWidth + summaryGap, summaryTop, summaryWidth, summaryCardHeight, "Status", data.status);
        drawCoverCard(pdf, margin, summaryTop + summaryCardHeight + 10, summaryWidth, summaryCardHeight, "Serventia", data.serventia);
        drawCoverCard(pdf, margin + summaryWidth + summaryGap, summaryTop + summaryCardHeight + 10, summaryWidth, summaryCardHeight, "Prioridade", data.prioridade);

        const sectionTop = summarySectionTop + summarySectionHeight + 16;
        const dataRowGap = 10;
        const colGap = 12;
        const colWidth = (pageWidth - margin * 2 - colGap) / 2;
        const ativoList = data.poloAtivos && data.poloAtivos.length ? data.poloAtivos.map(name => `• ${name}`).join("\n") : "-";
        const passivoList = data.poloPassivos && data.poloPassivos.length ? data.poloPassivos.map(name => `• ${name}`).join("\n") : "-";
        const hClasse = getCardHeight(pdf, colWidth, data.classe, 68);
        const hAssunto = getCardHeight(pdf, colWidth, data.assunto, 68);
        const hRow1 = Math.max(hClasse, hAssunto);
        const hValor = getCardHeight(pdf, colWidth, data.valorCausa, 54);
        const hFase = getCardHeight(pdf, colWidth, data.fase, 54);
        const hRow2 = Math.max(hValor, hFase);
        const hDist = getCardHeight(pdf, pageWidth - margin * 2, data.distribuicao, 52);
        const hAtivo = getCardHeight(pdf, pageWidth - margin * 2, ativoList, 60);
        const hPassivo = getCardHeight(pdf, pageWidth - margin * 2, passivoList, 60);
        const dataSectionHeight = 34 + hRow1 + dataRowGap + hRow2 + dataRowGap + hDist + dataRowGap + hAtivo + dataRowGap + hPassivo + 16;

        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(margin, sectionTop, pageWidth - margin * 2, dataSectionHeight, 10, 10, "F");
        pdf.setDrawColor(215, 223, 238);
        pdf.roundedRect(margin, sectionTop, pageWidth - margin * 2, dataSectionHeight, 10, 10, "S");
        pdf.setTextColor(23, 54, 95);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.text("Dados Processuais", margin + 14, sectionTop + 22);

        const gridTop = sectionTop + 34;
        drawCoverCard(pdf, margin, gridTop, colWidth, hRow1, "Classe", data.classe);
        drawCoverCard(pdf, margin + colWidth + colGap, gridTop, colWidth, hRow1, "Assunto(s)", data.assunto);
        drawCoverCard(pdf, margin, gridTop + hRow1 + dataRowGap, colWidth, hRow2, "Valor da causa", data.valorCausa);
        drawCoverCard(pdf, margin + colWidth + colGap, gridTop + hRow1 + dataRowGap, colWidth, hRow2, "Fase processual", data.fase);
        drawCoverCard(pdf, margin, gridTop + hRow1 + dataRowGap + hRow2 + dataRowGap, pageWidth - margin * 2, hDist, "Distribuição", data.distribuicao);
        drawCoverCard(pdf, margin, gridTop + hRow1 + dataRowGap + hRow2 + dataRowGap + hDist + dataRowGap, pageWidth - margin * 2, hAtivo, "Polo ativo", ativoList);
        drawCoverCard(
            pdf,
            margin,
            gridTop + hRow1 + dataRowGap + hRow2 + dataRowGap + hDist + dataRowGap + hAtivo + dataRowGap,
            pageWidth - margin * 2,
            hPassivo,
            "Polo passivo",
            passivoList
        );

        pdf.setDrawColor(200, 210, 228);
        pdf.line(margin, pageHeight - 44, pageWidth - margin, pageHeight - 44);
        pdf.setTextColor(80, 95, 123);
        pdf.setFontSize(9.5);
        pdf.text("Documento gerado automaticamente pelo script de customizações.", margin, pageHeight - 28);
    }

    function drawMovementsPage(pdf, data) {
        pdf.addPage();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 40;
        pdf.setFillColor(26, 70, 128);
        pdf.rect(0, 0, pageWidth, 64, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text("Movimentações do Processo", margin, 40);
        pdf.setTextColor(15, 23, 42);

        const body = (data.movimentacoes || []).map(item => [
            item.numero || "-",
            item.movimentacao || "-",
            item.data || "-",
            item.usuario || "-"
        ]);

        if (typeof pdf.autoTable === "function") {
            pdf.autoTable({
                startY: 82,
                margin: { left: margin, right: margin },
                head: [["Nº", "Movimentação", "Data", "Usuário"]],
                body,
                styles: {
                    font: "helvetica",
                    fontSize: 8.6,
                    cellPadding: 5,
                    lineColor: [223, 231, 243],
                    lineWidth: 0.4,
                    textColor: [15, 23, 42],
                    valign: "top"
                },
                headStyles: {
                    fillColor: [35, 101, 184],
                    textColor: [255, 255, 255],
                    fontStyle: "bold",
                    halign: "left"
                },
                columnStyles: {
                    0: { cellWidth: 28, halign: "center" },
                    1: { cellWidth: 250 },
                    2: { cellWidth: 95 },
                    3: { cellWidth: "auto" }
                }
            });
            return;
        }

        let y = 86;
        const headers = "Nº | Movimentação | Data | Usuário";
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text(headers, margin, y);
        y += 16;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.2);
        body.forEach(row => {
            const line = `${row[0]} | ${row[1]} | ${row[2]} | ${row[3]}`;
            const wrapped = pdf.splitTextToSize(line, pageWidth - margin * 2);
            if (y + wrapped.length * 12 > pageHeight - 24) {
                pdf.addPage();
                y = 34;
            }
            pdf.text(wrapped, margin, y);
            y += wrapped.length * 12 + 6;
        });
    }

    function applyPdfPageNumbers(pdf) {
        const total = pdf.internal.getNumberOfPages();
        const margin = 40;
        for (let page = 1; page <= total; page += 1) {
            pdf.setPage(page);
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            pdf.setTextColor(92, 109, 138);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(9);
            pdf.text(`Página ${page} de ${total}`, pageWidth - margin, pageHeight - 14, { align: "right" });
        }
    }

    async function generateProcessMirrorPdf(doc, triggerButton) {
        if (!isProcessPageDoc(doc)) return;
        const button = triggerButton || doc.getElementById("projudi-mirror-pdf-btn");
        const originalHtml = button ? button.innerHTML : "";
        try {
            if (button) {
                button.disabled = true;
                button.style.opacity = "0.7";
                button.innerHTML = "<i class='fa-solid fa-spinner fa-spin fa-2x'></i>";
            }
            await ensureMirrorPdfDeps(doc);
            const win = doc.defaultView || window;
            const jsPDFClass = win?.jspdf?.jsPDF;
            if (!jsPDFClass) throw new Error("Biblioteca jsPDF indisponível.");

            const data = collectProcessSnapshotData(doc);
            if (!data.processNumber) throw new Error("Não foi possível identificar os dados do processo.");

            const pdf = new jsPDFClass({ unit: "pt", format: "a4", compress: true });
            drawCoverPage(pdf, data);
            drawMovementsPage(pdf, data);
            applyPdfPageNumbers(pdf);
            const filename = `espelho_processo_${data.processNumber.replace(/[^\d]/g, "") || "projudi"}.pdf`;
            pdf.save(filename);
        } catch (error) {
            const msg = error && error.message ? error.message : "Falha ao gerar o espelho do processo.";
            if (typeof doc.defaultView?.mostrarMensagemErro === "function") {
                doc.defaultView.mostrarMensagemErro("Espelho do Processo", msg);
            } else {
                doc.defaultView?.alert(`Espelho do Processo: ${msg}`);
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.style.opacity = "";
                button.innerHTML = originalHtml;
            }
        }
    }

    function ensureProcessMirrorPdfButton(doc) {
        if (!isProcessPageDoc(doc)) return false;
        if (doc.getElementById("projudi-mirror-pdf-btn")) return true;
        const originalPdfButton = findExistingProcessPdfButton(doc);
        if (!originalPdfButton || !originalPdfButton.parentElement) return false;

        const button = doc.createElement("button");
        button.type = "button";
        button.id = "projudi-mirror-pdf-btn";
        button.setAttribute("title", "Gerar espelho do processo");
        button.setAttribute("alt", "Gerar espelho do processo");
        button.style.cssText = "margin-left: 6px; border: none; background: none; cursor: pointer;";
        button.innerHTML = "<i class='fa-solid fa-file-circle-plus fa-2x' style='color:#3e5f8c;'></i>";
        button.addEventListener("click", () => {
            generateProcessMirrorPdf(doc, button);
        });

        originalPdfButton.insertAdjacentElement("afterend", button);
        return true;
    }

    function scheduleProcessMirrorPdfRefresh(doc) {
        if (mirrorPdfWorkScheduled) return;
        mirrorPdfWorkScheduled = true;
        requestAnimationFrame(() => {
            mirrorPdfWorkScheduled = false;
            safeRun("Falha ao sincronizar botão de espelho do processo.", () => ensureProcessMirrorPdfButton(doc));
        });
    }

    function initProcessMirrorPdfFeature(doc) {
        if (!doc || !doc.body || !isProcessPageDoc(doc)) return;
        ensureProcessMirrorPdfButton(doc);
        if (mirrorPdfObserver) mirrorPdfObserver.disconnect();
        mirrorPdfObserver = new MutationObserver((mutations) => {
            if (!isRelevantMirrorPdfMutation(mutations)) return;
            scheduleProcessMirrorPdfRefresh(doc);
        });
        mirrorPdfObserver.observe(doc.body, { childList: true, subtree: true });
    }

    function teardownProcessMirrorPdfFeature(doc) {
        if (mirrorPdfObserver) {
            mirrorPdfObserver.disconnect();
            mirrorPdfObserver = null;
        }
        const btn = doc && doc.getElementById ? doc.getElementById("projudi-mirror-pdf-btn") : null;
        if (btn) btn.remove();
    }


    function injectNoScrollbarStyle(doc) {
        if (!doc || !doc.documentElement) return;
        let style = doc.getElementById(NO_SCROLLBAR_STYLE_ID);
        if (!style) {
            style = doc.createElement("style");
            style.id = NO_SCROLLBAR_STYLE_ID;
            style.textContent = NO_SCROLLBAR_CSS;
            (doc.head || doc.documentElement).appendChild(style);
        }
        doc.documentElement.style.overflowY = "auto";
        doc.documentElement.style.overflowX = "hidden";
        if (doc.body) {
            doc.body.style.overflowY = "auto";
            doc.body.style.overflowX = "hidden";
        }
    }

    function removeNoScrollbarStyle(doc) {
        if (!doc || !doc.documentElement) return;
        removeStyleFromDoc(doc, NO_SCROLLBAR_STYLE_ID);
        doc.documentElement.style.removeProperty("overflow-y");
        doc.documentElement.style.removeProperty("overflow-x");
        if (doc.body) {
            doc.body.style.removeProperty("overflow-y");
            doc.body.style.removeProperty("overflow-x");
        }
    }

    function syncNoScrollbarForDoc(doc) {
        if (settings.enabled && settings.enableRemoveScrollbar) injectNoScrollbarStyle(doc);
        else removeNoScrollbarStyle(doc);
    }

    function syncNoScrollbarForCurrentIframe() {
        const iframe = document.getElementById("Principal");
        if (!iframe) return;
        try {
            if (iframe.contentDocument) syncNoScrollbarForDoc(iframe.contentDocument);
        } catch (_) {}
    }

    function ensureMovimentacoesModule() {
        if (!isTopWindow()) return null;
        if (!movimentacoesModule) movimentacoesModule = createMovimentacoesModule();
        return movimentacoesModule;
    }

    function syncMovimentacoesModule() {
        const module = ensureMovimentacoesModule();
        if (!module) return;
        module.setEnabled(settings.enabled && settings.enableMovimentacoes);
    }

    function openMovimentacoesPanel() {
        if (!settings.enabled || !settings.enableMovimentacoes) {
            window.alert("Ative o módulo de movimentações antes de configurar as opções.");
            return;
        }
        const module = ensureMovimentacoesModule();
        if (module) module.openPanel();
    }

    function createMovimentacoesModule() {
          if (window.top !== window.self) return;

          const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
          const ARROW_STR = '(?:-\\s*>|→|⇒|»|›)';

          const TYPES_ORDER = [
            'Despacho',
            'Decisão',
            'Julgamento',
            'Juntada',
            'Autos Conclusos',
            'Petição Enviada',
            'Recebido',
            'Despacho Autos ao Contador',
            'Relatório',
            'Juntada Documento Histórico Processo Físico'
          ];

          const DISPLAY_NAMES = {
            'Despacho Autos ao Contador': 'Autos ao Contador',
            'Juntada Documento Histórico Processo Físico': 'Histórico Proc. Físico'
          };

          const USER_DEFAULT_RED_TYPES = new Set([
            'Despacho',
            'Decisão',
            'Julgamento',
            'Despacho Autos ao Contador',
            'Relatório'
          ]);

          const DEFAULTS = {
            enabled: settings.enabled && settings.enableMovimentacoes,
            padding: '6px 8px',
            colors: {
              'Despacho': '#eedbdb',
              'Decisão': '#eedbdb',
              'Julgamento': '#eedbdb',
              'Juntada': '#e8f5e9',
              'Autos Conclusos': '#d6d6d6',
              'Petição Enviada': '#d1effc',
              'Recebido': '#d1effc',
              'Despacho Autos ao Contador': '#eedbdb',
              'Relatório': '#eedbdb',
              'Juntada Documento Histórico Processo Físico': '#d1effc'
            },
            textColorsMov: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = '#111827';
              return acc;
            }, {}),
            textColorsUser: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = USER_DEFAULT_RED_TYPES.has(k) ? '#dc2626' : '#111827';
              return acc;
            }, {}),
            enabledTypes: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = true;
              return acc;
            }, {}),
            noBackgroundTypes: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = false;
              return acc;
            }, {}),
            boldTypesMov: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = true;
              return acc;
            }, {}),
            italicTypesMov: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = false;
              return acc;
            }, {}),
            boldTypesUser: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = USER_DEFAULT_RED_TYPES.has(k);
              return acc;
            }, {}),
            italicTypesUser: TYPES_ORDER.reduce((acc, k) => {
              acc[k] = false;
              return acc;
            }, {}),
            targets: {
              mov: TYPES_ORDER.reduce((acc, k) => {
                acc[k] = true;
                return acc;
              }, {}),
              user: TYPES_ORDER.reduce((acc, k) => {
                acc[k] = USER_DEFAULT_RED_TYPES.has(k);
                return acc;
              }, {})
            },
            movTextMode: 'first-line'
          };

          const STORAGE_KEY = 'projudi_highlight_movs_cfg_v28';
          const DOC_STYLE_ID = 'phm-doc-style-v28';
          const PANEL_OVERLAY_ID = 'phm-overlay-root';
          const MOV_TABLE_ROWS_SELECTOR = '#TabelaArquivos tbody tr, #tabListaProcesso tr';
          const MOV_TABLES_SELECTOR = '#TabelaArquivos, #tabListaProcesso';
          const PRIMARY_FRAME_SELECTOR = 'iframe#Principal, iframe[name="userMainFrame"], frame#Principal, frame[name="userMainFrame"]';
          const LOG_PREFIX = '[Movimentações]';
          const PAGE_ORIGIN = window.location.origin;

          function logInfo(message, meta) {
            if (meta === undefined) {
              console.info(LOG_PREFIX, message);
              return;
            }
            console.info(LOG_PREFIX, message, meta);
          }

          function logWarn(message, meta) {
            if (meta === undefined) {
              console.warn(LOG_PREFIX, message);
              return;
            }
            console.warn(LOG_PREFIX, message, meta);
          }

          function logError(message, error) {
            console.error(LOG_PREFIX, message, error);
          }

          function safeRun(label, task, fallbackValue) {
            try {
              return task();
            } catch (error) {
              logError(label, error);
              return fallbackValue;
            }
          }

          function lockBodyScroll(doc = document) {
            const body = doc && doc.body;
            if (!body) return () => {};
            const win = (doc && doc.defaultView) || window;
            const KEY = "__pjBodyScrollLock__";
            const state = win[KEY] || (win[KEY] = { count: 0, prevOverflow: "" });
            if (state.count === 0) {
              state.prevOverflow = body.style.overflow;
              body.style.overflow = "hidden";
            }
            state.count += 1;
            let released = false;
            return () => {
              if (released) return;
              released = true;
              state.count = Math.max(0, state.count - 1);
              if (state.count === 0) body.style.overflow = state.prevOverflow;
            };
          }

          function deepMerge(base, add) {
            for (const k in add) {
              const v = add[k];
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                base[k] = deepMerge(base[k] || {}, v);
              } else {
                base[k] = v;
              }
            }
            return base;
          }

          function readCfg() {
            try {
              const raw = localStorage.getItem(STORAGE_KEY);
              if (!raw) return deepClone(DEFAULTS);
              const parsed = JSON.parse(raw);
              const cfg = deepMerge(deepClone(DEFAULTS), parsed);

              if (parsed && parsed.textColors && typeof parsed.textColors === 'object') {
                Object.keys(parsed.textColors).forEach((k) => {
                  const val = parsed.textColors[k];
                  cfg.textColorsMov[k] = val;
                  if (!parsed.textColorsUser) cfg.textColorsUser[k] = val;
                });
              }

              if (parsed && parsed.boldTypes && typeof parsed.boldTypes === 'object') {
                Object.keys(parsed.boldTypes).forEach((k) => {
                  const val = !!parsed.boldTypes[k];
                  cfg.boldTypesMov[k] = val;
                  if (!parsed.boldTypesUser) cfg.boldTypesUser[k] = val;
                });
              }

              if (parsed && parsed.italicTypes && typeof parsed.italicTypes === 'object') {
                Object.keys(parsed.italicTypes).forEach((k) => {
                  const val = !!parsed.italicTypes[k];
                  cfg.italicTypesMov[k] = val;
                  if (!parsed.italicTypesUser) cfg.italicTypesUser[k] = val;
                });
              }

              if (!cfg.targets || typeof cfg.targets !== 'object') cfg.targets = { mov: {}, user: {} };
              if (!cfg.targets.mov) cfg.targets.mov = {};
              if (!cfg.targets.user) cfg.targets.user = {};
              delete cfg.targets.row;

              if (cfg.movTextMode !== 'first-line' && cfg.movTextMode !== 'full') {
                cfg.movTextMode = 'first-line';
              }

              return cfg;
            } catch (error) {
              logWarn('Falha ao ler configuração. Voltando para o padrão.', error);
              return deepClone(DEFAULTS);
            }
          }

          function saveCfg(cfg) {
            safeRun('Falha ao salvar configuração.', () => {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
            });
          }

          function toHexColor(any) {
            if (/^#([0-9a-f]{3}){1,2}$/i.test(any || '')) return any;
            const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(any || '');
            if (!m) return '#111827';
            const [r, g, b] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
            return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
          }

          let CFG = readCfg();

          addMovimentacoesStyle(`
            #${PANEL_OVERLAY_ID} {
              position: fixed;
              inset: 0;
              z-index: 2147483647;
              background: rgba(11, 18, 32, .5);
              backdrop-filter: blur(4px);
              -webkit-backdrop-filter: blur(4px);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 18px;
            }

            #${PANEL_OVERLAY_ID} .phm-panel {
              width: min(980px, calc(100vw - 24px));
              max-height: min(88vh, 860px);
              border-radius: 14px;
              border: 1px solid #dbe3ef;
              background: #ffffff;
              box-shadow: 0 24px 70px rgba(2, 6, 23, .30);
              overflow: hidden;
              display: flex;
              flex-direction: column;
              color: #0f172a;
              font: 14px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              transform: translateY(6px) scale(.985);
              opacity: .96;
              animation: phm-pop-in .16s ease forwards;
            }

            @keyframes phm-pop-in {
              from { transform: translateY(6px) scale(.985); opacity: .96; }
              to { transform: translateY(0) scale(1); opacity: 1; }
            }

            #${PANEL_OVERLAY_ID} .phm-panel *,
            #${PANEL_OVERLAY_ID} .phm-panel *::before,
            #${PANEL_OVERLAY_ID} .phm-panel *::after {
              box-sizing: border-box;
            }

            #${PANEL_OVERLAY_ID} button,
            #${PANEL_OVERLAY_ID} input,
            #${PANEL_OVERLAY_ID} label,
            #${PANEL_OVERLAY_ID} span {
              text-indent: 0 !important;
              letter-spacing: normal !important;
              text-transform: none !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif !important;
            }

            #${PANEL_OVERLAY_ID} .phm-head {
              flex: 0 0 auto;
              padding: 14px 16px;
              color: #ffffff;
              background: linear-gradient(135deg, #0f3e75, #1f5ca4);
              border-bottom: 1px solid #dbe3ef;
            }

            #${PANEL_OVERLAY_ID} .phm-head-bar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
            }

            #${PANEL_OVERLAY_ID} .phm-title-wrap {
              min-width: 0;
            }

            #${PANEL_OVERLAY_ID} .phm-title {
              margin: 0;
              font-size: 16px;
              font-weight: 700;
              line-height: 1.2;
              color: #ffffff !important;
              text-transform: none !important;
              text-decoration: none !important;
              border: 0 !important;
              border-bottom: 0 !important;
              padding: 0 !important;
            }

            #${PANEL_OVERLAY_ID} .phm-subtitle {
              margin: 2px 0 0;
              font-size: 12px;
              opacity: .92;
              color: #ffffff !important;
              text-transform: none !important;
              text-decoration: none !important;
              border: 0 !important;
              border-bottom: 0 !important;
              padding: 0 !important;
            }

            #${PANEL_OVERLAY_ID} .phm-close {
              border: 0;
              width: 28px;
              height: 28px;
              border-radius: 999px;
              background: rgba(255, 255, 255, .2);
              color: #ffffff;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
              line-height: 1.2;
            }

            #${PANEL_OVERLAY_ID} .phm-close:hover {
              background: rgba(255, 255, 255, .3);
            }

            #${PANEL_OVERLAY_ID} .phm-body {
              flex: 1 1 auto;
              min-height: 0;
              overflow: auto;
              padding: 16px;
              display: flex;
              flex-direction: column;
              gap: 14px;
              background: linear-gradient(180deg, #f8fbff 0%, #f2f6fc 100%);
            }

            #${PANEL_OVERLAY_ID} .phm-global {
              border: 1px solid #dbe3ef;
              border-radius: 12px;
              background: #ffffff;
              padding: 14px 16px;
              box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
            }

            #${PANEL_OVERLAY_ID} .phm-global-title {
              margin: 0 0 10px;
              color: #334155;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: .03em;
              text-align: left;
            }

            #${PANEL_OVERLAY_ID} .phm-global-options {
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              justify-content: flex-start;
            }

            #${PANEL_OVERLAY_ID} .phm-global-options label {
              display: inline-flex;
              align-items: center;
              gap: 7px;
              padding: 9px 12px;
              border: 1px solid #dbe3ef;
              border-radius: 999px;
              background: #f8fbff;
              color: #334155;
              font-size: 13px;
              font-weight: 600;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-global-options input[type='radio'] {
              margin: 0;
              accent-color: #0f3e75;
            }

            #${PANEL_OVERLAY_ID} .phm-accordion {
              display: flex;
              flex-direction: column;
              gap: 10px;
            }

            #${PANEL_OVERLAY_ID} .phm-rule {
              border: 1px solid #dbe3ef;
              border-radius: 12px;
              background: #ffffff;
              overflow: hidden;
              box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
            }

            #${PANEL_OVERLAY_ID} .phm-rule.is-disabled {
              opacity: .62;
            }

            #${PANEL_OVERLAY_ID} .phm-rule-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              padding: 12px 14px;
              background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
              cursor: pointer;
              user-select: none;
              list-style: none;
            }

            #${PANEL_OVERLAY_ID} .phm-rule-head::-webkit-details-marker {
              display: none;
            }

            #${PANEL_OVERLAY_ID} .phm-rule:not([open]) .phm-rule-head {
              border-bottom: 0;
            }

            #${PANEL_OVERLAY_ID} .phm-rule[open] .phm-rule-head {
              border-bottom: 1px solid #e5edf8;
            }

            #${PANEL_OVERLAY_ID} .phm-rule-content {
              padding: 14px;
              background: #fbfdff;
            }

            #${PANEL_OVERLAY_ID} .phm-type {
              display: inline-flex;
              align-items: center;
              gap: 9px;
              min-width: 0;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-type input[type='checkbox'] {
              width: 18px;
              height: 18px;
              margin: 0;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-type span {
              overflow: hidden;
              white-space: normal;
              font-weight: 600;
              color: #1e293b;
              font-size: 15px;
              line-height: 1.2;
            }

            #${PANEL_OVERLAY_ID} .phm-rule-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(180px, 1fr));
              gap: 12px;
              align-items: start;
            }

            #${PANEL_OVERLAY_ID} .phm-field {
              min-width: 0;
              border: 1px solid #dbe3ef;
              border-radius: 12px;
              background: #ffffff;
              padding: 11px 12px;
            }

            #${PANEL_OVERLAY_ID} .phm-field-title {
              margin: 0 0 8px;
              color: #334155;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: .03em;
              text-align: left;
            }

            #${PANEL_OVERLAY_ID} .phm-field-body {
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }

            #${PANEL_OVERLAY_ID} .phm-center {
              display: flex;
              align-items: center;
              gap: 10px;
              flex-wrap: wrap;
              justify-content: flex-start;
            }

            #${PANEL_OVERLAY_ID} .phm-options-row {
              display: flex;
              align-items: center;
              justify-content: flex-start;
              gap: 10px;
              flex-wrap: wrap;
              width: 100%;
            }

            #${PANEL_OVERLAY_ID} .phm-center input[type='color'] {
              width: 56px;
              height: 34px;
              border: 1px solid #cbd5e1;
              border-radius: 999px;
              padding: 3px;
              background: #fff;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-center label {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              color: #334155;
              font-size: 12px;
              font-weight: 600;
              white-space: nowrap;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-center label input[type='checkbox'] {
              width: 16px;
              height: 16px;
              margin: 0;
              cursor: pointer;
            }

            #${PANEL_OVERLAY_ID} .phm-chip {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 88px;
              height: 32px;
              border: 1px solid #dbe3ef;
              border-radius: 999px;
              font-size: 13px;
              font-weight: 700;
              color: #111827;
              background: #f8fbff;
              padding: 0 10px;
            }

            #${PANEL_OVERLAY_ID} .phm-foot {
              flex: 0 0 auto;
              display: flex;
              justify-content: flex-end;
              gap: 8px;
              padding: 12px 16px;
              border-top: 1px solid #dbe3ef;
              background: #f8fafc;
            }

            #${PANEL_OVERLAY_ID} .phm-btn {
              min-width: 86px;
              padding: 8px 12px;
              border-radius: 8px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
              line-height: 1.2;
              color: #1e293b;
              background: #ffffff;
              border: 1px solid #cbd5e1;
            }

            #${PANEL_OVERLAY_ID} .phm-btn:hover {
              background: #f8fafc;
            }

            #${PANEL_OVERLAY_ID} .phm-btn-save {
              color: #ffffff;
              background: #0f3e75;
              border-color: #0f3e75;
              font-weight: 600;
            }

            #${PANEL_OVERLAY_ID} .phm-btn-save:hover {
              background: #0d3562;
            }

            @media (max-width: 1040px) {
              #${PANEL_OVERLAY_ID} .phm-body {
                padding: 12px;
              }

              #${PANEL_OVERLAY_ID} .phm-foot {
                padding: 10px 12px;
              }

              #${PANEL_OVERLAY_ID} .phm-rule-head {
                padding: 10px 12px;
              }

              #${PANEL_OVERLAY_ID} .phm-rule-content {
                padding: 12px;
              }

              #${PANEL_OVERLAY_ID} .phm-rule-grid {
                grid-template-columns: 1fr;
              }
            }

            @media (max-width: 700px) {
              #${PANEL_OVERLAY_ID} .phm-rule-head {
                flex-direction: column;
                align-items: flex-start;
              }

              #${PANEL_OVERLAY_ID} .phm-rule-grid {
                grid-template-columns: 1fr;
              }
            }
          `);

          function ensureDocStyle(doc) {
            safeRun('Falha ao injetar estilo do documento.', () => {
              if (!doc || !doc.head) return;
              if (doc.getElementById(DOC_STYLE_ID)) return;
              const style = doc.createElement('style');
              style.id = DOC_STYLE_ID;
              style.textContent = `
                .phm-bold-fragment, .phm-bold-fragment * { font-weight: 700 !important; }
                .phm-italic-fragment, .phm-italic-fragment * { font-style: italic !important; }
              `;
              doc.head.appendChild(style);
            });
          }

          const PADROES_MOV = [
            {
              key: 'Juntada Documento Histórico Processo Físico',
              re: /^\s*Juntada\s+de\s+Documento\s*(?:\r?\n|\s+)\s*Hist[óo]rico\s+Processo\s+F[ií]sico\b/iu
            },
            { key: 'Despacho', re: new RegExp('^\\s*Despacho\\s*' + ARROW_STR, 'iu') },
            { key: 'Decisão', re: new RegExp('^\\s*Decis[aã]o\\s*' + ARROW_STR, 'iu') },
            { key: 'Julgamento', re: new RegExp('^\\s*Julgamento\\s*' + ARROW_STR, 'iu') },
            { key: 'Juntada', re: new RegExp('^\\s*Juntada\\s*' + ARROW_STR, 'iu') },
            { key: 'Autos Conclusos', re: /^(\s*)Autos\s+Conclusos\b/iu },
            { key: 'Petição Enviada', re: /^(\s*)Peti[cç][aã]o\s+Enviada\b/iu },
            { key: 'Recebido', re: /^(\s*)Recebido\b/iu },
            { key: 'Despacho Autos ao Contador', re: /^(\s*)Despacho\s+Autos\s+ao\s+Contador\b/iu },
            { key: 'Relatório', re: new RegExp('^\\s*Relat[óo]rio\\s*' + ARROW_STR, 'iu') }
          ];

          function matchKind(text) {
            for (const p of PADROES_MOV) {
              if (CFG.enabledTypes[p.key] === false) continue;
              if (p.re.test(text)) return p.key;
            }
            return null;
          }

          function removeFirstLineWrapper(td) {
            const wrappers = td.querySelectorAll('span.phm-format-fragment[data-phm-firstline="1"]');
            wrappers.forEach((wrap) => {
              const parent = wrap.parentNode;
              if (!parent) return;
              while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
              parent.removeChild(wrap);
            });
          }

          function applyFirstLogicalLineFormat(td, kind) {
            removeFirstLineWrapper(td);
            if (!kind) return;

            const bold = !!CFG.boldTypesMov[kind];
            const italic = !!CFG.italicTypesMov[kind];
            if (!bold && !italic) return;

            const nodes = Array.from(td.childNodes);
            if (!nodes.length) return;

            const selected = [];
            let hasContent = false;

            for (const node of nodes) {
              if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') {
                if (!hasContent) continue;
                break;
              }

              if (node.nodeType === Node.TEXT_NODE) {
                let txt = node.nodeValue || '';
                while (!hasContent && txt.length && (txt[0] === '\n' || txt[0] === '\r')) {
                  txt = txt.slice(1);
                  node.nodeValue = txt;
                }

                if (!txt.length) {
                  selected.push(node);
                  continue;
                }

                const idx = txt.search(/[\n\r]/);
                if (idx >= 0) {
                  if (idx === 0) {
                    if (!hasContent) {
                      node.nodeValue = txt.slice(1);
                      continue;
                    }
                    break;
                  }

                  const tail = node.splitText(idx);
                  tail.nodeValue = tail.nodeValue.replace(/^\r?\n/, '');
                  const br = td.ownerDocument.createElement('br');
                  td.insertBefore(br, tail);

                  selected.push(node);
                  if (/\S/.test(node.nodeValue || '')) hasContent = true;
                  break;
                }

                selected.push(node);
                if (/\S/.test(txt)) hasContent = true;
                continue;
              }

              selected.push(node);
              hasContent = true;
            }

            if (!selected.length || !hasContent) return;

            const wrap = td.ownerDocument.createElement('span');
            wrap.className = 'phm-format-fragment';
            if (bold) wrap.classList.add('phm-bold-fragment');
            if (italic) wrap.classList.add('phm-italic-fragment');
            wrap.setAttribute('data-phm-firstline', '1');

            td.insertBefore(wrap, selected[0]);
            selected.forEach((n) => {
              if (n.parentNode === td) wrap.appendChild(n);
            });
          }

          function clearStyles(tr, movTd, userTd) {
            tr.style.background = '';
            tr.removeAttribute('data-phm-styled');

            const cells = tr.children ? Array.from(tr.children) : [];
            cells.forEach((cell) => {
              cell.style.color = '';
              cell.style.fontWeight = '';
              cell.style.fontStyle = '';
            });

            if (movTd) {
              movTd.style.padding = '';
              removeFirstLineWrapper(movTd);
            }

            if (userTd) {
              userTd.style.color = '';
              userTd.style.fontWeight = '';
              userTd.style.fontStyle = '';
            }
          }

          function isTargetEnabled(kind, target) {
            return !!(CFG.targets && CFG.targets[target] && CFG.targets[target][kind]);
          }

          function styleRow(tr, kind) {
            const bg = CFG.colors[kind] || '#eef2ff';
            const noBg = !!CFG.noBackgroundTypes[kind];
            tr.style.background = noBg ? '' : bg;
          }

          function styleCell(td, kind) {
            if (!isTargetEnabled(kind, 'mov')) return;
            const fg = CFG.textColorsMov[kind] || '#111827';
            const bold = !!CFG.boldTypesMov[kind];
            const italic = !!CFG.italicTypesMov[kind];
            const useFirstLineMode = CFG.movTextMode !== 'full';

            td.style.color = fg;
            td.style.padding = CFG.padding;

            if (useFirstLineMode) {
              td.style.fontWeight = '';
              td.style.fontStyle = '';
              applyFirstLogicalLineFormat(td, kind);
            } else {
              removeFirstLineWrapper(td);
              td.style.fontWeight = bold ? '700' : '400';
              td.style.fontStyle = italic ? 'italic' : 'normal';
            }
          }

          function styleUserCell(td, kind) {
            if (!td || !isTargetEnabled(kind, 'user')) return;
            const fg = CFG.textColorsUser[kind] || '#111827';
            const bold = !!CFG.boldTypesUser[kind];
            const italic = !!CFG.italicTypesUser[kind];
            td.style.color = fg;
            td.style.fontWeight = bold ? '700' : '400';
            td.style.fontStyle = italic ? 'italic' : 'normal';
          }

          function getMovCell(tr) {
            return tr.querySelector('td.filtro_coluna_movimentacao');
          }

          function getUserCell(tr) {
            const cells = tr.children;
            if (!cells || cells.length < 4) return null;
            return cells[3];
          }

          /**
           * Resolves the frame src using the owner document base URI.
           * @param {HTMLIFrameElement|HTMLFrameElement} frame
           * @returns {URL|null}
           */
          function resolveFrameUrl(frame) {
            if (!frame || typeof frame.getAttribute !== 'function') return null;
            const rawSrc = String(frame.getAttribute('src') || '').trim();
            if (!rawSrc) return null;
            try {
              return new URL(rawSrc, (frame.ownerDocument && frame.ownerDocument.baseURI) || document.baseURI);
            } catch {
              return null;
            }
          }

          /**
           * Avoids touching frames that are explicitly cross-origin, such as file previews hosted on S3.
           * @param {HTMLIFrameElement|HTMLFrameElement} frame
           * @returns {boolean}
           */
          function isTrackableFrame(frame) {
            const frameUrl = resolveFrameUrl(frame);
            if (!frameUrl) return true;
            if (frameUrl.protocol === 'about:') return frameUrl.href === 'about:blank';
            if (frameUrl.protocol !== 'http:' && frameUrl.protocol !== 'https:') return false;
            return frameUrl.origin === PAGE_ORIGIN;
          }

          /**
           * Returns the document of a same-origin frame when it is accessible.
           * Cross-origin or not-yet-ready frames are skipped silently.
           * @param {HTMLIFrameElement|HTMLFrameElement} frame
           * @returns {Document|null}
           */
          function getAccessibleFrameDocument(frame) {
            if (!frame) return null;
            if (!isTrackableFrame(frame)) return null;
            try {
              const frameDoc = frame.contentDocument;
              if (frameDoc && frameDoc.documentElement) return frameDoc;
            } catch {
              return null;
            }

            try {
              const frameWindow = frame.contentWindow;
              if (!frameWindow || !frameWindow.document || !frameWindow.document.documentElement) {
                return null;
              }
              return frameWindow.document;
            } catch {
              return null;
            }
          }

          /**
           * The Projudi content lives in the main frame. Nested frames inside the process page
           * often host file previews and should not be traversed by this script.
           * @param {ParentNode} root
           * @returns {(HTMLIFrameElement|HTMLFrameElement)[]}
           */
          function getProcessableFrames(root) {
            if (!root || typeof root.querySelectorAll !== 'function') return [];
            return Array.from(root.querySelectorAll(PRIMARY_FRAME_SELECTOR)).filter((frame) => isTrackableFrame(frame));
          }

          function walkDocuments(callback) {
            const visited = new WeakSet();
            if (!document || visited.has(document)) return;
            visited.add(document);
            callback(document);

            getProcessableFrames(document).forEach((frame) => {
              const frameDoc = getAccessibleFrameDocument(frame);
              if (!frameDoc || visited.has(frameDoc)) return;
              visited.add(frameDoc);
              callback(frameDoc);
            });
          }

          function buildConfigSignature() {
            return JSON.stringify({
              enabled: CFG.enabled,
              padding: CFG.padding,
              colors: CFG.colors,
              textColorsMov: CFG.textColorsMov,
              textColorsUser: CFG.textColorsUser,
              enabledTypes: CFG.enabledTypes,
              noBackgroundTypes: CFG.noBackgroundTypes,
              boldTypesMov: CFG.boldTypesMov,
              italicTypesMov: CFG.italicTypesMov,
              boldTypesUser: CFG.boldTypesUser,
              italicTypesUser: CFG.italicTypesUser,
              targets: CFG.targets,
              movTextMode: CFG.movTextMode
            });
          }

          function buildRowSignature(movText, userText, kind, configSignature) {
            return [kind || '', movText.trim(), userText.trim(), configSignature].join('||');
          }

          const rowStateCache = new WeakMap();
          let configSignature = buildConfigSignature();

          /**
           * Applies or clears styling for a single table row based on cached state.
           * @param {HTMLTableRowElement} row
           */
          function processRow(row) {
            const movTd = getMovCell(row);
            const userTd = getUserCell(row);
            if (!movTd) return;

            const movText = movTd.textContent || '';
            const userText = userTd ? (userTd.textContent || '') : '';
            const kind = CFG.enabled ? matchKind(movText) : null;
            const signature = buildRowSignature(movText, userText, kind, configSignature);
            const previous = rowStateCache.get(row);

            if (previous && previous.signature === signature) return;

            if (!kind) {
              clearStyles(row, movTd, userTd);
              rowStateCache.set(row, { signature, kind: null });
              return;
            }

            styleRow(row, kind);
            styleCell(movTd, kind);
            styleUserCell(userTd, kind);
            row.setAttribute('data-phm-styled', '1');
            rowStateCache.set(row, { signature, kind });
          }

          /**
           * Processes all movement rows contained in a table.
           * @param {Document} doc
           * @param {Element} table
           */
          function processTable(doc, table) {
            ensureDocStyle(doc);
            const rows = table.querySelectorAll('tbody tr, tr');
            rows.forEach((row) => processRow(row));
          }

          function processDoc(doc) {
            if (!doc) return;
            const tables = doc.querySelectorAll(MOV_TABLES_SELECTOR);
            tables.forEach((table) => processTable(doc, table));
          }

          function reapply() {
            configSignature = buildConfigSignature();
            walkDocuments((doc) => {
              safeRun('Falha ao reaplicar destaques.', () => {
                ensureDocStyle(doc);
                const rows = doc.querySelectorAll('tr[data-phm-styled="1"]');
                rows.forEach((row) => {
                  rowStateCache.delete(row);
                  clearStyles(row, getMovCell(row), getUserCell(row));
                });
                processDoc(doc);
              });
            });
          }

          function panelHtml() {
            const items = TYPES_ORDER.map((key) => {
              const label = DISPLAY_NAMES[key] || key;
              const bg = toHexColor(CFG.colors[key] || '#eef2ff');
              const fgMov = toHexColor(CFG.textColorsMov[key] || '#111827');
              const fgUser = toHexColor(CFG.textColorsUser[key] || '#111827');
              const enabled = CFG.enabledTypes[key] !== false ? 'checked' : '';
              const noBg = CFG.noBackgroundTypes[key] ? 'checked' : '';
              const boldMov = CFG.boldTypesMov[key] ? 'checked' : '';
              const italicMov = CFG.italicTypesMov[key] ? 'checked' : '';
              const boldUser = CFG.boldTypesUser[key] ? 'checked' : '';
              const italicUser = CFG.italicTypesUser[key] ? 'checked' : '';
              const targetMov = (CFG.targets && CFG.targets.mov && CFG.targets.mov[key]) ? 'checked' : '';
              const targetUser = (CFG.targets && CFG.targets.user && CFG.targets.user[key]) ? 'checked' : '';
              const open = key === TYPES_ORDER[0] ? 'open' : '';
              return `
                <details class="phm-rule" data-phm-rule="${key}" ${open}>
                  <summary class="phm-rule-head">
                    <label class="phm-type">
                      <input type="checkbox" data-phm-enabled="${key}" ${enabled}>
                      <span>${label}</span>
                    </label>
                    <span class="phm-chip" data-phm-chip="${key}">Prévia</span>
                  </summary>
                  <div class="phm-rule-content">
                    <div class="phm-rule-grid">
                    <div class="phm-field">
                      <p class="phm-field-title">Cor de fundo</p>
                      <div class="phm-field-body">
                        <div class="phm-center">
                          <input type="color" value="${bg}" data-phm-color-bg="${key}" title="Cor de fundo">
                        </div>
                        <div class="phm-options-row">
                          <label><input type="checkbox" data-phm-nobg="${key}" ${noBg}> Sem fundo</label>
                        </div>
                      </div>
                    </div>
                    <div class="phm-field">
                      <p class="phm-field-title">Texto Mov.</p>
                      <div class="phm-field-body">
                        <div class="phm-center">
                          <input type="color" value="${fgMov}" data-phm-color-fg-mov="${key}" title="Cor do texto da coluna Movimentação">
                        </div>
                        <div class="phm-options-row">
                          <label><input type="checkbox" data-phm-target-mov="${key}" ${targetMov}> Aplicar</label>
                          <label><input type="checkbox" data-phm-bold-mov="${key}" ${boldMov}> Negrito</label>
                          <label><input type="checkbox" data-phm-italic-mov="${key}" ${italicMov}> Itálico</label>
                        </div>
                      </div>
                    </div>
                    <div class="phm-field">
                      <p class="phm-field-title">Texto Usuário</p>
                      <div class="phm-field-body">
                        <div class="phm-center">
                          <input type="color" value="${fgUser}" data-phm-color-fg-user="${key}" title="Cor do texto da coluna Usuário">
                        </div>
                        <div class="phm-options-row">
                          <label><input type="checkbox" data-phm-target-user="${key}" ${targetUser}> Aplicar</label>
                          <label><input type="checkbox" data-phm-bold-user="${key}" ${boldUser}> Negrito</label>
                          <label><input type="checkbox" data-phm-italic-user="${key}" ${italicUser}> Itálico</label>
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>
                </details>
              `;
            }).join('');

            return `
              <div class="phm-head">
                <div class="phm-head-bar">
                  <div class="phm-title-wrap">
                    <h3 class="phm-title">Ajuste de Movimentações</h3>
                    <p class="phm-subtitle">Configuração por coluna: Movimentação e Usuário</p>
                  </div>
                  <button class="phm-close" data-phm-action="close" title="Fechar">×</button>
                </div>
              </div>
              <div class="phm-body">
                <div class="phm-accordion">${items}</div>
                <div class="phm-global">
                  <p class="phm-global-title">Texto da coluna Movimentação</p>
                  <div class="phm-global-options">
                    <label><input type="radio" name="phm-mov-text-mode" value="first-line" ${CFG.movTextMode !== 'full' ? 'checked' : ''}> Negrito/itálico só na primeira linha</label>
                    <label><input type="radio" name="phm-mov-text-mode" value="full" ${CFG.movTextMode === 'full' ? 'checked' : ''}> Negrito/itálico no texto completo</label>
                  </div>
                </div>
              </div>
              <div class="phm-foot">
                <button class="phm-btn" data-phm-action="reset">Padrão</button>
                <button class="phm-btn" data-phm-action="cancel">Fechar</button>
                <button class="phm-btn phm-btn-save" data-phm-action="save">Salvar</button>
              </div>
            `;
          }

          function refreshPanelPreviews(root) {
            TYPES_ORDER.forEach((key) => {
              const row = root.querySelector(`[data-phm-rule="${CSS.escape(key)}"]`);
              const chip = root.querySelector(`[data-phm-chip="${CSS.escape(key)}"]`);
              const enabledInput = root.querySelector(`[data-phm-enabled="${CSS.escape(key)}"]`);
              const bgInput = root.querySelector(`[data-phm-color-bg="${CSS.escape(key)}"]`);
              const fgMovInput = root.querySelector(`[data-phm-color-fg-mov="${CSS.escape(key)}"]`);
              const fgUserInput = root.querySelector(`[data-phm-color-fg-user="${CSS.escape(key)}"]`);
              const noBgInput = root.querySelector(`[data-phm-nobg="${CSS.escape(key)}"]`);
              const boldMovInput = root.querySelector(`[data-phm-bold-mov="${CSS.escape(key)}"]`);
              const italicMovInput = root.querySelector(`[data-phm-italic-mov="${CSS.escape(key)}"]`);
              const boldUserInput = root.querySelector(`[data-phm-bold-user="${CSS.escape(key)}"]`);
              const italicUserInput = root.querySelector(`[data-phm-italic-user="${CSS.escape(key)}"]`);
              const targetMovInput = root.querySelector(`[data-phm-target-mov="${CSS.escape(key)}"]`);
              const targetUserInput = root.querySelector(`[data-phm-target-user="${CSS.escape(key)}"]`);
              if (!row || !chip || !enabledInput || !bgInput || !fgMovInput || !fgUserInput || !noBgInput || !boldMovInput || !italicMovInput || !boldUserInput || !italicUserInput || !targetMovInput || !targetUserInput) return;

              chip.style.background = noBgInput.checked ? 'transparent' : bgInput.value;
              chip.style.color = targetUserInput.checked && !targetMovInput.checked ? fgUserInput.value : fgMovInput.value;
              chip.style.fontWeight = (boldMovInput.checked || boldUserInput.checked) ? '700' : '600';
              chip.style.fontStyle = (italicMovInput.checked || italicUserInput.checked) ? 'italic' : 'normal';
              chip.style.opacity = (targetMovInput.checked || targetUserInput.checked) ? '1' : '.55';
              row.classList.toggle('is-disabled', !enabledInput.checked);
            });
          }

          function closePanel() {
            const overlay = document.getElementById(PANEL_OVERLAY_ID);
            if (!overlay) return;
            if (typeof overlay.__phmUnlockScroll === "function") overlay.__phmUnlockScroll();
            overlay.remove();
          }

          function ensurePanel() {
            if (document.getElementById(PANEL_OVERLAY_ID)) return;

            const overlay = document.createElement('div');
            overlay.id = PANEL_OVERLAY_ID;
            overlay.className = 'phm-overlay';
            overlay.innerHTML = `<div class="phm-panel" role="dialog" aria-modal="true">${panelHtml()}</div>`;
            overlay.__phmUnlockScroll = lockBodyScroll(document);

            overlay.addEventListener('click', (ev) => {
              if (ev.target === overlay) closePanel();
            });

            overlay.addEventListener('input', (ev) => {
              const t = ev.target;
              if (
                t.matches('[data-phm-enabled], [data-phm-color-bg], [data-phm-color-fg-mov], [data-phm-color-fg-user], [data-phm-nobg], [data-phm-bold-mov], [data-phm-italic-mov], [data-phm-bold-user], [data-phm-italic-user], [data-phm-target-mov], [data-phm-target-user], input[name="phm-mov-text-mode"]')
              ) {
                refreshPanelPreviews(overlay);
              }
            });

            overlay.addEventListener('click', (ev) => {
              const btn = ev.target.closest('[data-phm-action]');
              if (!btn) return;
              const action = btn.getAttribute('data-phm-action');

              if (action === 'close') {
                closePanel();
                return;
              }

              if (action === 'cancel') {
                closePanel();
                return;
              }

              if (action === 'reset') {
                CFG = deepClone(DEFAULTS);
                saveCfg(CFG);
                closePanel();
                ensurePanel();
                reapply();
                return;
              }

              if (action === 'save') {
                overlay.querySelectorAll('[data-phm-enabled]').forEach((inp) => {
                  CFG.enabledTypes[inp.getAttribute('data-phm-enabled')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-color-bg]').forEach((inp) => {
                  CFG.colors[inp.getAttribute('data-phm-color-bg')] = inp.value;
                });

                overlay.querySelectorAll('[data-phm-color-fg-mov]').forEach((inp) => {
                  CFG.textColorsMov[inp.getAttribute('data-phm-color-fg-mov')] = inp.value;
                });

                overlay.querySelectorAll('[data-phm-color-fg-user]').forEach((inp) => {
                  CFG.textColorsUser[inp.getAttribute('data-phm-color-fg-user')] = inp.value;
                });

                overlay.querySelectorAll('[data-phm-nobg]').forEach((inp) => {
                  CFG.noBackgroundTypes[inp.getAttribute('data-phm-nobg')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-bold-mov]').forEach((inp) => {
                  CFG.boldTypesMov[inp.getAttribute('data-phm-bold-mov')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-italic-mov]').forEach((inp) => {
                  CFG.italicTypesMov[inp.getAttribute('data-phm-italic-mov')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-bold-user]').forEach((inp) => {
                  CFG.boldTypesUser[inp.getAttribute('data-phm-bold-user')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-italic-user]').forEach((inp) => {
                  CFG.italicTypesUser[inp.getAttribute('data-phm-italic-user')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-target-mov]').forEach((inp) => {
                  CFG.targets.mov[inp.getAttribute('data-phm-target-mov')] = inp.checked;
                });

                overlay.querySelectorAll('[data-phm-target-user]').forEach((inp) => {
                  CFG.targets.user[inp.getAttribute('data-phm-target-user')] = inp.checked;
                });

                const movTextModeInput = overlay.querySelector('input[name="phm-mov-text-mode"]:checked');
                CFG.movTextMode = movTextModeInput && movTextModeInput.value === 'full' ? 'full' : 'first-line';

                saveCfg(CFG);
                reapply();
                closePanel();
                return;
              }
            });

            document.body.appendChild(overlay);
            refreshPanelPreviews(overlay);
          }

          const docObservers = new WeakMap();
          const frameListeners = new WeakSet();
          const docProcessState = new WeakMap();

          function getDocProcessState(doc) {
            const existing = docProcessState.get(doc);
            if (existing) return existing;
            const created = { raf: 0 };
            docProcessState.set(doc, created);
            return created;
          }

          function isRelevantMutationNode(node) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
            const element = /** @type {Element} */ (node);
            return Boolean(
              (element.matches && (
                element.matches('iframe, frame') ||
                element.matches(MOV_TABLES_SELECTOR) ||
                element.matches('tbody, tr') ||
                element.matches('td.filtro_coluna_movimentacao')
              )) ||
              (element.querySelector && (
                element.querySelector('iframe, frame') ||
                element.querySelector(MOV_TABLES_SELECTOR) ||
                element.querySelector('td.filtro_coluna_movimentacao')
              ))
            );
          }

          function scheduleProcessDoc(doc) {
            const state = getDocProcessState(doc);
            if (state.raf) return;
            state.raf = requestAnimationFrame(() => {
              state.raf = 0;
              safeRun('Falha ao processar documento.', () => {
                CFG = readCfg();
                configSignature = buildConfigSignature();
                processDoc(doc);
                ensureObservers();
              });
            });
          }

          function observeDoc(doc) {
            if (!doc || !doc.documentElement || docObservers.has(doc)) return;
            ensureDocStyle(doc);
            const observer = new MutationObserver((mutations) => {
              const hasRelevantMutation = mutations.some((mutation) => {
                if (mutation.type !== 'childList') return false;
                if (isRelevantMutationNode(mutation.target)) return true;
                return Array.from(mutation.addedNodes).some((node) => isRelevantMutationNode(node));
              });
              if (!hasRelevantMutation) return;
              scheduleProcessDoc(doc);
            });
            observer.observe(doc.documentElement, { subtree: true, childList: true });
            docObservers.set(doc, observer);
          }

          function ensureObservers() {
            walkDocuments((doc) => {
              observeDoc(doc);
              const frames = doc === document ? getProcessableFrames(doc) : [];
              frames.forEach((frame) => {
                if (!isTrackableFrame(frame)) return;
                if (frameListeners.has(frame)) return;
                frameListeners.add(frame);
                frame.addEventListener('load', () => {
                  if (!isTrackableFrame(frame)) return;
                  const frameDoc = getAccessibleFrameDocument(frame);
                  if (!frameDoc) return;
                  scheduleProcessDoc(frameDoc);
                }, true);
              });
            });
          }

          function reviveAfterReturn() {
            walkDocuments((doc) => scheduleProcessDoc(doc));
          }

          function bootMovimentacoes() {
            ensureObservers();
            walkDocuments((doc) => scheduleProcessDoc(doc));

            window.addEventListener('pageshow', reviveAfterReturn, true);
            window.addEventListener('focus', reviveAfterReturn, true);
            document.addEventListener('visibilitychange', () => {
              if (!document.hidden) reviveAfterReturn();
            });

            document.addEventListener('keydown', (ev) => {
              if (ev.key === 'Escape') closePanel();
            }, true);
          }

          function setMovimentacoesEnabled(enabled) {
            CFG.enabled = !!enabled;
            saveCfg(CFG);
            reapply();
          }

          function addMovimentacoesStyle(css) {
            if (!document.head) return;
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
          }

          bootMovimentacoes();
          return { openPanel: ensurePanel, closePanel, reapply, setEnabled: setMovimentacoesEnabled };

    }

    function removeStyleFromDoc(doc, styleId) {
        if (!doc) return;
        const style = doc.getElementById(styleId);
        if (style) style.remove();
    }

    function resetLayoutEffects() {
        clearPendingIframeRetryTimers();
        iframeRetryRunId += 1;
        stopPopupContextObserver();
        if (mouseMoveListenerBound) {
            document.removeEventListener("mousemove", onDocumentMouseMove, { passive: true });
            mouseMoveListenerBound = false;
        }
        if (boundAutoHideIframeEl) {
            boundAutoHideIframeEl.removeEventListener("mouseenter", onIframeMouseEnter);
            boundAutoHideIframeEl = null;
        }
        removeStyleFromDoc(document, "projudi-top-header-style");
        removeStyleFromDoc(document, "projudi-ajuste-largura");
        if (movimentacoesModule) movimentacoesModule.setEnabled(false);
        if (popupHookCleanup) popupHookCleanup();
        removeProcessPopupUi();
        setHeaderHidden(false);
        updateHeaderRevealZone();

        const iframe = document.getElementById("Principal");
        if (iframe) {
            iframe.style.removeProperty("height");
            iframe.style.removeProperty("width");
            iframe.style.removeProperty("display");
            try {
                if (iframe.contentDocument) {
                    removeStyleFromDoc(iframe.contentDocument, "projudi-ajuste-largura");
                    removeNoScrollbarStyle(iframe.contentDocument);
                    teardownProcessMirrorPdfFeature(iframe.contentDocument);
                }
            } catch (_) {}
        }
    }

    function applySettingsNow() {
        if (!isTopWindow()) {
            safeRun("Falha ao aplicar configurações no iframe.", () => {
                if (settings.enabled) injectWidthCSS(document);
                else removeStyleFromDoc(document, "projudi-ajuste-largura");
                syncNoScrollbarForDoc(document);
                if (settings.enabled && settings.enableProcessMirrorPdf) initProcessMirrorPdfFeature(document);
                else teardownProcessMirrorPdfFeature(document);
                syncProcessPopupModeForDoc(document);
            });
            return;
        }

        if (!settings.enabled) {
            resetLayoutEffects();
            return;
        }

        registerMenu();
        injectTopHeaderCSS();
        syncTopObservers();
        syncNoScrollbarForCurrentIframe();
        if (isStandaloneContentPage()) injectWidthCSS(document);
        else removeStyleFromDoc(document, "projudi-ajuste-largura");
        syncPopupModeFromIframeContext();
        syncMovimentacoesModule();
        ajustarAlturaIframe();
        if (headerHidden && !settings.autoHideHeader) setHeaderHidden(false);
        updateHeaderRevealZone();
        if (shouldManageIframeFeatures()) retryInjectInIframe(3, 120);
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        registerMenu();
        if (isTopWindow()) {
            initTop();
            window.addEventListener("message", (event) => {
                if (!event || !event.data || event.data.type !== OPEN_SETTINGS_MESSAGE) return;
                openSettingsPanel();
            });
            window.addEventListener("focus", registerMenu, { passive: true });
            window.addEventListener("pageshow", registerMenu, { passive: true });
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") registerMenu();
            });
        } else {
            initInsideFrame();
        }
        logInfo("Script inicializado.");
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(init, 300);
    } else {
        document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
    }
})();
