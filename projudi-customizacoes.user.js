// ==UserScript==
// @name         Customizações
// @namespace    projudi-customizacoes.user.js
// @version      1.9
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
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_KEY = "projudi-wide-settings-v1";
    const MENU_LABEL = "Gerenciar Customizações";
    const DEFAULT_SETTINGS = {
        enabled: true,
        autoHideHeader: false,
        enableIframeAutoHeight: true,
        openProcessFilesInPopup: true,
        contentWidthPercent: 100,
        headerWidthPercent: 100,
        centerContent: true,
        compactMode: false,
        fontScalePercent: 100,
        sideBackground: "original",
        hideClock: false,
        hideHeaderIcons: false,
        applyToStandalonePages: true
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
    let popupOwnerWin = null;
    let popupDock = null;
    let popupDockToggle = null;
    let popupDockMenu = null;
    let popupWindowCounter = 0;
    const popupWindows = new Map();
    let popupUnlockBodyScroll = null;
    let popupActiveId = null;
    let popupPrintCleanup = null;

    function onIframeLoad() {
        retryInjectInIframe(14, 220);
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
        } catch (_) {}
        return normalizeSettings(DEFAULT_SETTINGS);
    }

    function saveSettings(next) {
        settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...next });
        if (typeof GM_setValue === "function") {
            GM_setValue(STORAGE_KEY, JSON.stringify(settings));
        }
    }

    function normalizeSettings(value) {
        const next = { ...DEFAULT_SETTINGS, ...(value || {}) };
        next.enabled = next.enabled !== false;
        next.autoHideHeader = !!next.autoHideHeader;
        next.enableIframeAutoHeight = !!next.enableIframeAutoHeight;
        next.openProcessFilesInPopup = next.openProcessFilesInPopup !== false;
        next.contentWidthPercent = sanitizeWidthPercent(next.contentWidthPercent);
        next.headerWidthPercent = sanitizeWidthPercent(next.headerWidthPercent);
        next.centerContent = true;
        next.compactMode = !!next.compactMode;
        next.fontScalePercent = sanitizeFontScale(next.fontScalePercent);
        next.sideBackground = sanitizeSideBackground(next.sideBackground);
        next.hideClock = !!next.hideClock;
        next.hideHeaderIcons = !!next.hideHeaderIcons;
        next.applyToStandalonePages = next.applyToStandalonePages !== false;
        return next;
    }

    function sanitizeWidthPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.contentWidthPercent;
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
            menuCommandId = GM_registerMenuCommand(MENU_LABEL, openSettingsPanel);
        } catch (_) {}
    }

    function openSettingsPanel() {
        if (!isTopWindow()) return;
        if (document.getElementById("projudi-wide-panel-overlay")) return;

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
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px; background:#f8fafc;">
                    <div>
                        <div style="font-weight:700; color:#0f172a;">Ativar script</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Liga e desliga todos os ajustes sem precisar mexer nas configurações da extensão.</div>
                    </div>
                    <input type="checkbox" id="pj-enabled" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar cabeçalho automaticamente</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde o topo ao passar o mouse na área do processo.</div>
                    </div>
                    <input type="checkbox" id="pj-auto-hide" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ajuste automático da altura</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Calcula a altura ideal do iframe para usar melhor a tela.</div>
                    </div>
                    <input type="checkbox" id="pj-iframe-height" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Largura da página (%)</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Define a largura do conteúdo entre 60% e 100%.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="number" id="pj-content-width" min="60" max="100" step="1" style="width:72px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; text-align:right;">
                        <span style="font-size:13px; color:#334155;">%</span>
                    </div>
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Largura do topo (%)</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Largura da linha da logo e do menu superior.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="number" id="pj-header-width" min="60" max="100" step="1" style="width:72px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; text-align:right;">
                        <span style="font-size:13px; color:#334155;">%</span>
                    </div>
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Centralizar conteúdo</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Ativado por padrão para manter o layout centralizado.</div>
                    </div>
                    <input type="checkbox" id="pj-center-content" style="width:18px; height:18px; margin-top:2px;" disabled>
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Modo compacto</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Reduz espaços verticais em telas/tabelas.</div>
                    </div>
                    <input type="checkbox" id="pj-compact-mode" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Tamanho da fonte</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Ajusta a escala do texto do conteúdo.</div>
                    </div>
                    <select id="pj-font-scale" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                        <option value="90">90%</option>
                        <option value="100">100%</option>
                        <option value="110">110%</option>
                    </select>
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Fundo lateral</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Cor das áreas laterais quando a largura for menor que 100%.</div>
                    </div>
                    <select id="pj-side-bg" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; background:#fff;">
                        <option value="original">Original</option>
                        <option value="white">Branco</option>
                        <option value="light">Cinza claro</option>
                    </select>
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar relógio</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde apenas o cronômetro do topo.</div>
                    </div>
                    <input type="checkbox" id="pj-hide-clock" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar ícones utilitários</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde os ícones do topo (fonte, ajuda, voltar, sair, etc.).</div>
                    </div>
                    <input type="checkbox" id="pj-hide-icons" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Aplicar em páginas diretas</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Aplica ajustes também em links abertos fora do iframe.</div>
                    </div>
                    <input type="checkbox" id="pj-standalone" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #dbe3ef; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Abrir arquivos do processo em pop-up</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Nos eventos do processo, abre arquivos na mesma aba com opção de minimizar e fechar.</div>
                    </div>
                    <input type="checkbox" id="pj-process-popup" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <div style="font-size:12px; color:#64748b; margin-top:12px;">
                    As alterações são salvas e aplicadas imediatamente.
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
        const contentW = panel.querySelector("#pj-content-width");
        const headerW = panel.querySelector("#pj-header-width");
        const enabled = panel.querySelector("#pj-enabled");
        const centerContent = panel.querySelector("#pj-center-content");
        const compactMode = panel.querySelector("#pj-compact-mode");
        const fontScale = panel.querySelector("#pj-font-scale");
        const sideBg = panel.querySelector("#pj-side-bg");
        const hideClock = panel.querySelector("#pj-hide-clock");
        const hideIcons = panel.querySelector("#pj-hide-icons");
        const standalone = panel.querySelector("#pj-standalone");
        const processPopup = panel.querySelector("#pj-process-popup");

        enabled.checked = settings.enabled !== false;
        autoHide.checked = !!settings.autoHideHeader;
        iframeH.checked = !!settings.enableIframeAutoHeight;
        contentW.value = String(sanitizeWidthPercent(settings.contentWidthPercent));
        headerW.value = String(sanitizeWidthPercent(settings.headerWidthPercent));
        centerContent.checked = true;
        compactMode.checked = !!settings.compactMode;
        fontScale.value = String(sanitizeFontScale(settings.fontScalePercent));
        sideBg.value = sanitizeSideBackground(settings.sideBackground);
        hideClock.checked = !!settings.hideClock;
        hideIcons.checked = !!settings.hideHeaderIcons;
        standalone.checked = settings.applyToStandalonePages !== false;
        processPopup.checked = settings.openProcessFilesInPopup !== false;

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
            contentW.value = String(DEFAULT_SETTINGS.contentWidthPercent);
            headerW.value = String(DEFAULT_SETTINGS.headerWidthPercent);
            centerContent.checked = true;
            compactMode.checked = DEFAULT_SETTINGS.compactMode;
            fontScale.value = String(DEFAULT_SETTINGS.fontScalePercent);
            sideBg.value = DEFAULT_SETTINGS.sideBackground;
            hideClock.checked = DEFAULT_SETTINGS.hideClock;
            hideIcons.checked = DEFAULT_SETTINGS.hideHeaderIcons;
            standalone.checked = DEFAULT_SETTINGS.applyToStandalonePages;
            processPopup.checked = DEFAULT_SETTINGS.openProcessFilesInPopup;
        });

        panel.querySelector("#pj-save").addEventListener("click", () => {
            const widthPercent = sanitizeWidthPercent(contentW.value);
            const headerWidthPercent = sanitizeWidthPercent(headerW.value);
            contentW.value = String(widthPercent);
            headerW.value = String(headerWidthPercent);
            saveSettings({
                enabled: enabled.checked,
                autoHideHeader: autoHide.checked,
                enableIframeAutoHeight: iframeH.checked,
                contentWidthPercent: widthPercent,
                headerWidthPercent: headerWidthPercent,
                centerContent: true,
                compactMode: compactMode.checked,
                fontScalePercent: sanitizeFontScale(fontScale.value),
                sideBackground: sanitizeSideBackground(sideBg.value),
                hideClock: hideClock.checked,
                hideHeaderIcons: hideIcons.checked,
                applyToStandalonePages: standalone.checked,
                openProcessFilesInPopup: processPopup.checked
            });
            applySettingsNow();
            closePanel();
        });

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closePanel();
        });

        document.addEventListener("keydown", escClose);
    }

    function injectTopHeaderCSS() {
        const widthPercent = sanitizeWidthPercent(settings.headerWidthPercent);
        const widthValue = widthPercent + "%";
        const isCentered = settings.centerContent && widthPercent < 100;
        const gutterValue = isCentered ? `calc((100% - ${widthValue}) / 2)` : "0px";
        const centeredMargins = isCentered ? "auto" : "0";
        const topPageBg =
            settings.sideBackground === "white"
                ? "#ffffff"
                : settings.sideBackground === "light"
                    ? "#f3f4f6"
                    : "";

        const css = `
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

            #img_logotj {
                margin-left: 0 !important;
            }

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

            #cssmenu > ul {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                box-sizing: border-box !important;
            }

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

            #menuPrinciapl.menu > ul {
                float: left !important;
            }

            #menuPrinciapl #cronometro {
                float: right !important;
                margin-right: 0 !important;
            }

            #cssmenu > ul > li > a,
            #cssmenu > ul > li > a i {
                color: #ffffff !important;
            }

            #cssmenu ul ul a,
            #cssmenu ul ul i,
            #cssmenu ul ul li > a {
                color: #2f2f2f !important;
            }

            #cssmenu ul ul li:hover > a,
            #cssmenu ul ul li:hover > a i {
                color: #0f3e75 !important;
            }

            #cronometro {
                float: right !important;
                margin-right: calc(${gutterValue} + var(--pj-header-pad)) !important;
                margin-left: 0 !important;
                display: ${settings.hideClock ? "none" : "block"} !important;
            }

            #pgn_cabecalho > div[style*="float: right"] {
                display: ${settings.hideHeaderIcons ? "none" : "inline-block"} !important;
            }

            body > div[style*="height:28px"][style*="background-color:#ccc"] {
                border-bottom: 1px solid #cbd5e1;
            }
        `;

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
        popupOwnerWin = hostWin;
        return { hostWin, hostDoc };
    }

    function updatePopupBodyScrollLock() {
        const hasVisible = [...popupWindows.values()].some(state => !state.minimized);
        if (hasVisible) {
            if (!popupUnlockBodyScroll && popupOwnerDoc) popupUnlockBodyScroll = lockBodyScroll(popupOwnerDoc);
            return;
        }
        if (popupUnlockBodyScroll) {
            try {
                popupUnlockBodyScroll();
            } catch (_) {}
            popupUnlockBodyScroll = null;
        }
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
            openBtn.textContent = state.title || "Arquivo";
            openBtn.title = state.title || "Arquivo";
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
            "width:min(420px, calc(100vw - 24px))"
        ].join(";");

        const toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.textContent = "Arquivos (0)";
        toggle.style.cssText = [
            "width:100%",
            "height:34px",
            "padding:0 12px",
            "border:1px solid rgba(15,62,117,.25)",
            "border-radius:10px",
            "background:linear-gradient(180deg,#0f3e75,#0d3360)",
            "color:#fff",
            "font:600 13px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif",
            "cursor:pointer",
            "box-shadow:0 8px 18px rgba(2,6,23,.25)"
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
        popupOwnerWin = null;
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
        frame.style.cssText = "width:100%; height:100%; border:0; background:#fff;";
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

    function getFilenameFromTooltip(rawTitle) {
        const full = String(rawTitle || "").trim();
        if (!full) return "";
        const lines = full.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        const withExt = lines.find(v => /\.[a-z0-9]{2,8}$/i.test(v));
        if (withExt) return withExt;
        const first = lines[0] || "";
        return /\.[a-z0-9]{2,8}$/i.test(first) ? first : "";
    }

    function getPopupTitle(anchor, url) {
        const movement = getMovementLabel(anchor);
        const titleAttr = String(anchor.getAttribute("title") || "").trim();
        const fromTooltip = getFilenameFromTooltip(titleAttr);
        if (fromTooltip) return movement ? `${movement} • ${fromTooltip}` : fromTooltip;
        const fromUrl = getFilenameFromUrl(url);
        if (fromUrl) return movement ? `${movement} • ${fromUrl}` : fromUrl;
        if (titleAttr && /\.[a-z0-9]{2,6}$/i.test(titleAttr)) return movement ? `${movement} • ${titleAttr}` : titleAttr;
        const text = String(anchor.textContent || "").trim();
        if (text) return movement ? `${movement} • ${text}` : text;
        return "Arquivo do processo";
    }

    function createPopupWindow(doc, url, title) {
        popupWindowCounter += 1;
        const popupId = `pj-popup-${popupWindowCounter}`;

        const panel = doc.createElement("div");
        panel.id = popupId;
        panel.style.cssText = [
            "position:fixed",
            "top:10px",
            "left:10px",
            "right:10px",
            "bottom:10px",
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

        panel.appendChild(head);
        panel.appendChild(body);
        (doc.body || doc.documentElement).appendChild(panel);

        ensurePopupDock(doc);
        ensurePopupPrintHandler(doc);

        const state = {
            id: popupId,
            title: title || "Arquivo",
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

    function openProcessFilePopup(url, title, sourceDoc) {
        if (!url) return;
        const { hostDoc } = ensurePopupHost(sourceDoc || document);
        createPopupWindow(hostDoc, url, title);
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

            const title = getPopupTitle(anchor, url);
            openProcessFilePopup(url, title, doc);
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

    function canInjectIntoDoc(doc) {
        const html = doc.documentElement;
        const body = doc.body;
        return !(
            (html && html.hasAttribute(OPTOUT_ATTR)) ||
            (body && body.hasAttribute(OPTOUT_ATTR))
        );
    }

    function injectWidthCSS(doc) {
        if (!settings.enabled || !doc || !doc.head || !canInjectIntoDoc(doc)) return;
        const widthPercent = sanitizeWidthPercent(settings.contentWidthPercent);
        const widthValue = widthPercent + "%";
        const centeredMargins = settings.centerContent && widthPercent < 100 ? "auto" : "0";
        const pageBg =
            settings.sideBackground === "white"
                ? "#ffffff"
                : settings.sideBackground === "light"
                    ? "#f3f4f6"
                    : "";
        const fontScaleCss =
            settings.fontScalePercent !== 100
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
        if (!settings.enabled) return;
        const iframe = document.getElementById("Principal");
        if (!iframe || !iframe.contentDocument) return;

        iframe.style.width = "100%";
        iframe.style.display = "block";

        injectWidthCSS(iframe.contentDocument);
    }

    function retryInjectInIframe(times = 12, delay = 240) {
        if (!settings.enabled) return;
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
            bindIframeLoadListener();
            setupHeaderAutoHide();
            ajustarAlturaIframe();
        });
    }

    function watchForIframeAvailability() {
        bindIframeLoadListener();
        setupHeaderAutoHide();

        if (iframeAvailabilityObserver) iframeAvailabilityObserver.disconnect();
        iframeAvailabilityObserver = new MutationObserver(scheduleTopDomMaintenance);
        iframeAvailabilityObserver.observe(document.body, { childList: true, subtree: true });

        rememberTimeout(setTimeout(bindIframeLoadListener, 500));
        rememberTimeout(setTimeout(bindIframeLoadListener, 1200));
        rememberTimeout(setTimeout(bindIframeLoadListener, 2400));
    }

    function scheduleStandaloneRefresh() {
        if (standaloneDomWorkScheduled) return;
        standaloneDomWorkScheduled = true;
        requestAnimationFrame(() => {
            standaloneDomWorkScheduled = false;
            if (settings.enabled && isStandaloneContentPage()) injectWidthCSS(document);
        });
    }

    function initTop() {
        applySettingsNow();

        window.addEventListener("resize", ajustarAlturaIframe, { passive: true });

        watchForIframeAvailability();

        if (standaloneDomObserver) standaloneDomObserver.disconnect();
        standaloneDomObserver = new MutationObserver(scheduleStandaloneRefresh);
        standaloneDomObserver.observe(document.body, { childList: true, subtree: true });
    }

    function initInsideFrame() {
        if (settings.enabled) injectWidthCSS(document);
        if (settings.enabled && settings.openProcessFilesInPopup) {
            hookProcessFilePopupInDoc(document);
        } else {
            if (popupHookCleanup) popupHookCleanup();
            removeProcessPopupUi();
        }
    }

    function removeStyleFromDoc(doc, styleId) {
        if (!doc) return;
        const style = doc.getElementById(styleId);
        if (style) style.remove();
    }

    function resetLayoutEffects() {
        clearPendingIframeRetryTimers();
        iframeRetryRunId += 1;
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
                }
            } catch (_) {}
        }
    }

    function applySettingsNow() {
        if (!isTopWindow()) {
            if (settings.enabled) injectWidthCSS(document);
            else removeStyleFromDoc(document, "projudi-ajuste-largura");
            if (settings.enabled && settings.openProcessFilesInPopup) {
                hookProcessFilePopupInDoc(document);
            } else {
                if (popupHookCleanup) popupHookCleanup();
                removeProcessPopupUi();
            }
            return;
        }

        if (!settings.enabled) {
            resetLayoutEffects();
            return;
        }

        registerMenu();
        injectTopHeaderCSS();
        if (isStandaloneContentPage()) injectWidthCSS(document);
        else removeStyleFromDoc(document, "projudi-ajuste-largura");
        if (settings.openProcessFilesInPopup && document.getElementById("TabelaArquivos")) {
            hookProcessFilePopupInDoc(document);
        } else if (popupHookCleanup) {
            popupHookCleanup();
            removeProcessPopupUi();
        }
        ajustarAlturaIframe();
        if (headerHidden && !settings.autoHideHeader) setHeaderHidden(false);
        updateHeaderRevealZone();
        retryInjectInIframe(3, 120);
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
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(init, 300);
    } else {
        document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
    }
})();
