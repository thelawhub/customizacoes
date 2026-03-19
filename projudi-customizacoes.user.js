// ==UserScript==
// @name         Customizações
// @namespace    projudi-customizacoes.user.js
// @version      4.2
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Centraliza customizações visuais e de navegação do Projudi.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-customizacoes.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-customizacoes.user.js
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
        enableProcessMirrorPdf: true
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
            settings.enableProcessMirrorPdf
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
        if (!isTopWindow()) return;
        if (typeof GM_registerMenuCommand !== "function") return;
        if (menuCommandId && typeof GM_unregisterMenuCommand === "function") {
            try {
                GM_unregisterMenuCommand(menuCommandId);
            } catch (_) {}
        }
        try {
            menuCommandId = GM_registerMenuCommand("Gerenciar Customizações", openSettingsPanel);
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
                background: #ffffff !important;
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

            @media (max-width: 700px) {
                #projudi-wide-panel-overlay #pj-panel-body {
                    padding: 12px !important;
                }
                #projudi-wide-panel-overlay #pj-panel-footer {
                    padding: 10px 12px !important;
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
                <div style="font-size:12px; font-weight:700; color:#334155; letter-spacing:.03em; text-transform:uppercase; margin:0 0 8px 2px;">Geral</div>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; background:#f8fafc;">
                    <div>
                        <div style="font-weight:700; color:#0f172a;">Ativar script</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Liga e desliga todos os ajustes sem precisar mexer nas configurações da extensão.</div>
                    </div>
                    <input type="checkbox" id="pj-enabled" style="width:18px; height:18px; margin-top:2px;">
                </label>

                <div style="font-size:12px; font-weight:700; color:#334155; letter-spacing:.03em; text-transform:uppercase; margin:14px 0 8px 2px;">Navegação e Cabeçalho</div>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar cabeçalho automaticamente</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde o topo ao passar o mouse na área do processo.</div>
                    </div>
                    <input type="checkbox" id="pj-auto-hide" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ajuste automático da altura</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Calcula a altura ideal do iframe para usar melhor a tela.</div>
                    </div>
                    <input type="checkbox" id="pj-iframe-height" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar relógio</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde apenas o cronômetro do topo.</div>
                    </div>
                    <input type="checkbox" id="pj-hide-clock" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar ícones utilitários</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde os ícones do topo (fonte, ajuda, voltar, sair, etc.).</div>
                    </div>
                    <input type="checkbox" id="pj-hide-icons" style="width:18px; height:18px; margin-top:2px;">
                </label>

                <div style="font-size:12px; font-weight:700; color:#334155; letter-spacing:.03em; text-transform:uppercase; margin:14px 0 8px 2px;">Layout e Aparência</div>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Largura da página (%)</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Define a largura do conteúdo e do topo entre 60% e 100%.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="number" id="pj-content-width" min="60" max="100" step="1" style="width:72px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; text-align:right;">
                        <span style="font-size:13px; color:#334155;">%</span>
                        <input type="checkbox" id="pj-enable-width" title="Ativar ajuste de largura" style="width:18px; height:18px;">
                    </div>
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Centralizar conteúdo</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Ativado por padrão para manter o layout centralizado.</div>
                    </div>
                    <input type="checkbox" id="pj-center-content" style="width:18px; height:18px; margin-top:2px;" disabled>
                </label>
                <label id="pj-row-standalone" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Aplicar em páginas diretas</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Aplica ajustes também em links abertos fora do iframe.</div>
                    </div>
                    <input type="checkbox" id="pj-standalone" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label id="pj-row-side-bg" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Fundo lateral</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Cor das áreas laterais quando a largura for menor que 100%.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <select id="pj-side-bg" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                            <option value="original">Original</option>
                            <option value="white">Branco</option>
                            <option value="light">Cinza claro</option>
                        </select>
                        <input type="checkbox" id="pj-enable-side-bg" title="Ativar ajuste de fundo lateral" style="width:18px; height:18px;">
                    </div>
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Modo compacto</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Reduz espaços verticais em telas/tabelas.</div>
                    </div>
                    <input type="checkbox" id="pj-compact-mode" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Tamanho da fonte</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Ajusta a escala do texto do conteúdo.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <select id="pj-font-scale" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                            <option value="90">90%</option>
                            <option value="100">100%</option>
                            <option value="110">110%</option>
                        </select>
                        <input type="checkbox" id="pj-enable-font-scale" title="Ativar ajuste de fonte" style="width:18px; height:18px;">
                    </div>
                </label>

                <div style="font-size:12px; font-weight:700; color:#334155; letter-spacing:.03em; text-transform:uppercase; margin:14px 0 8px 2px;">Arquivos do Processo</div>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Abrir arquivos do processo em pop-up</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Nos eventos do processo, abre arquivos na mesma aba com opção de minimizar e fechar.</div>
                    </div>
                    <input type="checkbox" id="pj-process-popup" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Botão “Gerar espelho do processo”</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Mostra o botão ao lado do PDF padrão para gerar capa + movimentações via script.</div>
                    </div>
                    <input type="checkbox" id="pj-process-mirror-pdf" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label id="pj-row-popup-size" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Tamanho do pop-up (%)</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Define a largura e altura do pop-up entre 60% e 100% da janela.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="number" id="pj-popup-size" min="60" max="100" step="1" style="width:72px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; text-align:right;">
                        <span style="font-size:13px; color:#334155;">%</span>
                    </div>
                </label>
                <div style="font-size:12px; color:#64748b; margin-top:12px;">
                    As alterações são salvas e aplicadas imediatamente.
                </div>
                <div style="font-size:12px; font-weight:700; color:#334155; letter-spacing:.03em; text-transform:uppercase; margin:14px 0 8px 2px;">Backup remoto</div>
                <div style="padding:12px; border:1px solid #dbe3ef; border-radius:10px; background:#f8fafc;">
                    <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px;">
                        <div>
                            <div style="font-weight:600; color:#0f172a;">Ativar backup por Gist no GitHub.</div>
                            <div style="font-size:12px; color:#64748b; margin-top:2px;">Usa um arquivo deste script dentro do seu Gist único de backups.</div>
                        </div>
                        <input type="checkbox" id="pj-backup-enabled" style="width:18px; height:18px; margin-top:2px;">
                    </label>
                    <div style="display:grid; grid-template-columns:1fr; gap:10px;">
                        <input type="text" id="pj-backup-gist-id" placeholder="Gist ID" style="padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px;">
                        <input type="password" id="pj-backup-token" placeholder="Token do GitHub" style="padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px;">
                        <input type="text" id="pj-backup-file-name" placeholder="Nome do arquivo" style="padding:7px 9px; border:1px solid #cbd5e1; border-radius:8px;">
                    </div>
                    <label style="display:flex; align-items:center; gap:8px; margin-top:10px; font-size:13px; color:#334155;">
                        <input type="checkbox" id="pj-backup-auto" style="width:16px; height:16px;">
                        <span>Backup automático</span>
                    </label>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                        <button id="pj-backup-send" type="button" style="padding:7px 11px; min-width:130px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #cbd5e1; background:#fff; color:#1e293b; font-size:13px; font-weight:600; border-radius:8px; cursor:pointer;">Enviar backup</button>
                        <button id="pj-backup-restore" type="button" style="padding:7px 11px; min-width:130px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #cbd5e1; background:#fff; color:#1e293b; font-size:13px; font-weight:600; border-radius:8px; cursor:pointer;">Restaurar backup</button>
                        <button id="pj-backup-clear" type="button" style="padding:7px 11px; min-width:130px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #fecaca; background:#fff5f5; color:#b42318; font-size:13px; font-weight:600; border-radius:8px; cursor:pointer;">Limpar backup</button>
                    </div>
                    <div id="pj-backup-status" style="font-size:12px; color:#64748b; margin-top:10px;"></div>
                    <div id="pj-backup-last" style="font-size:11px; color:#94a3b8; margin-top:6px;">${formatLastBackupLabel(backupSettings.lastBackupAt)}</div>
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
        if (isStandaloneContentPage()) injectWidthCSS(document);
        else removeStyleFromDoc(document, "projudi-ajuste-largura");
        syncPopupModeFromIframeContext();
        ajustarAlturaIframe();
        if (headerHidden && !settings.autoHideHeader) setHeaderHidden(false);
        updateHeaderRevealZone();
        if (shouldManageIframeFeatures()) retryInjectInIframe(3, 120);
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        if (isTopWindow()) {
            registerMenu();
            initTop();
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
